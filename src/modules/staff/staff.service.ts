import { Inject, Injectable } from "@nestjs/common";
import { type AcceptInvitationInput, type InvitableStaffRole, type InviteStaffInput, isVendorRole, type Role, type StaffDirectoryView, type StaffInvitationPreview } from "../../shared";

import type { AuthPrincipal, RequestMeta } from "../../common/auth/auth-principal";
import { Errors } from "../../common/http/app-exception";
import { APP_CONFIG } from "../../config/config.module";
import type { AppConfig } from "../../config/config.schema";
import { isUniqueViolation, lockRow, PrismaService } from "../../database/prisma.service";
import type { Prisma } from "../../generated/prisma/client";
import { AuditService } from "../../infrastructure/audit/audit.service";
import { SecretHasherService } from "../../infrastructure/crypto/secret-hasher.service";
import { EMAIL_SENDER, type EmailSender } from "../../infrastructure/email/email.port";
import { AttemptLimiterService } from "../../infrastructure/rate-limit/attempt-limiter.service";
import { PasswordService } from "../auth/password/password.service";
import { type IssuedAuthentication, SessionIssuerService } from "../auth/sessions/session-issuer.service";
import { SessionService } from "../auth/sessions/session.service";
import { StaffEmails } from "./staff-emails";

const INVITATION_DAYS = 3;
function otherScopes(partnerId: string | null): Prisma.StaffInvitationWhereInput {
  return partnerId ? { OR: [{ partnerId: null }, { partnerId: { not: partnerId } }] } : { partnerId: { not: null } };
}

const INVITES_PER_DAY = { name: "staff-invites", limit: 30, windowSeconds: 24 * 60 * 60 };

type InvitedRole = InvitableStaffRole | "FULFILMENT_PARTNER" | "PARTNER_STAFF";

interface Inviter {
  userId: string | null;
  role: Role | null;
  quiet: boolean;
}

export interface InvitationRequest {
  email: string;
  role: InvitedRole;
  countryCode: string | null;
  partnerId: string | null;
}

const ROLE_LABELS: Record<InvitedRole, string> = {
  FULFILMENT_PARTNER: "the fulfilment partner lead",
  PARTNER_STAFF: "fulfilment partner staff",
  WAREHOUSE_OPERATOR: "a warehouse operator",
  COUNTRY_OPS: "country operations",
  COMPLIANCE: "compliance",
  FINANCE_ADMIN: "finance",
  ADMIN: "an administrator",
};

@Injectable()
export class StaffService {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(EMAIL_SENDER) private readonly email: EmailSender,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    private readonly hasher: SecretHasherService,
    private readonly passwords: PasswordService,
    private readonly issuer: SessionIssuerService,
    private readonly sessions: SessionService,
    private readonly limiter: AttemptLimiterService,
    private readonly audit: AuditService,
  ) {}

  async directory(): Promise<StaffDirectoryView> {
    const members = await this.prisma.user.findMany({
      where: { role: { notIn: ["VENDOR_OWNER", "VENDOR_MEMBER", "FULFILMENT_PARTNER", "PARTNER_STAFF"] } },
      select: { id: true, email: true, role: true, countryCode: true, status: true, mfaEnrolledAt: true },
      orderBy: [{ role: "asc" }, { email: "asc" }],
      take: 500,
    });
    const invitations = await this.prisma.staffInvitation.findMany({ where: { status: "PENDING", expiresAt: { gt: new Date() }, partnerId: null }, orderBy: { createdAt: "asc" } });
    return {
      members: members.map(({ id, mfaEnrolledAt, ...member }) => ({ ...member, userId: id, mfaEnrolled: mfaEnrolledAt !== null })),
      invitations: invitations.map((invitation) => ({
        id: invitation.id,
        email: invitation.email,
        role: invitation.role as InvitableStaffRole,
        countryCode: invitation.countryCode,
        expiresAt: invitation.expiresAt.toISOString(),
      })),
    };
  }

  async invite(principal: AuthPrincipal, input: InviteStaffInput, meta: RequestMeta): Promise<void> {
    if (input.countryCode) {
      if (!(await this.prisma.country.findUnique({ where: { code: input.countryCode } }))) {
        throw Errors.validation({ countryCode: ["Choose a country on the platform"] });
      }
    }
    await this.issueInvitation(principal, { email: input.email, role: input.role, countryCode: input.countryCode ?? null, partnerId: null }, meta);
  }

  async issueInvitation(principal: AuthPrincipal, input: InvitationRequest, meta: RequestMeta): Promise<void> {
    await this.limiter.consume(INVITES_PER_DAY, principal.userId);
    await this.createInvitation({ userId: principal.userId, role: principal.role, quiet: principal.partnerId !== null }, input, meta, "INVITE");
  }

  inviteApplicant(input: InvitationRequest, meta: RequestMeta): Promise<void> {
    return this.createInvitation({ userId: null, role: null, quiet: true }, input, meta, "APPLICATION");
  }

  private async createInvitation(inviter: Inviter, input: InvitationRequest, meta: RequestMeta, purpose: "INVITE" | "APPLICATION"): Promise<void> {
    const taken = await this.prisma.user.findUnique({ where: { email: input.email }, select: { id: true } });
    const elsewhere = await this.prisma.staffInvitation.findFirst({
      where: { email: input.email, status: "PENDING", expiresAt: { gt: new Date() }, ...otherScopes(input.partnerId) },
      select: { id: true },
    });
    if (taken || elsewhere) {
      if (inviter.quiet) {
        return;
      }
      throw Errors.invalidTransition(taken ? "This email already has an account." : "This email has a pending invitation elsewhere. Revoke it first.");
    }
    const token = this.hasher.randomToken();
    await this.prisma.$transaction(async (tx) => {
      await tx.staffInvitation.updateMany({ where: { email: input.email, status: "PENDING", partnerId: input.partnerId }, data: { status: "REVOKED", revokedAt: new Date() } });
      const created = await tx.staffInvitation.create({
        data: {
          email: input.email,
          role: input.role,
          countryCode: input.countryCode,
          partnerId: input.partnerId,
          tokenHash: this.tokenHash(token),
          invitedBy: inviter.userId,
          expiresAt: new Date(Date.now() + INVITATION_DAYS * 24 * 60 * 60 * 1000),
        },
        select: { id: true },
      });
      await this.audit.record(
        {
          actor: { userId: inviter.userId, role: inviter.role },
          action: purpose === "APPLICATION" ? "partner.applicant_invited" : "staff.invited",
          resourceType: "staff_invitation",
          resourceId: created.id,
          countryCode: input.countryCode,
          after: { email: input.email, role: input.role, partnerId: input.partnerId },
          meta,
        },
        tx,
      );
    });
    const link = `${this.config.WEB_PUBLIC_URL}/staff-invite#token=${encodeURIComponent(token)}`;
    const partner = input.partnerId ? await this.prisma.fulfilmentPartner.findUnique({ where: { id: input.partnerId }, select: { legalName: true } }) : null;
    await this.email.send(purpose === "APPLICATION" ? StaffEmails.application(input.email, link) : StaffEmails.invitation(input.email, ROLE_LABELS[input.role], link, partner?.legalName));
  }

  async revoke(principal: AuthPrincipal, invitationId: string, meta: RequestMeta, partnerId: string | null = null): Promise<void> {
    const revoked = await this.prisma.staffInvitation.updateMany({ where: { id: invitationId, status: "PENDING", partnerId }, data: { status: "REVOKED", revokedAt: new Date() } });
    if (revoked.count === 0) {
      throw Errors.notFound();
    }
    await this.audit.record({ actor: { userId: principal.userId, role: principal.role }, action: "staff.invitation_revoked", resourceType: "staff_invitation", resourceId: invitationId, meta });
  }

  async suspend(principal: AuthPrincipal, userId: string, meta: RequestMeta, partnerId: string | null = null): Promise<void> {
    if (userId === principal.userId) {
      throw Errors.invalidTransition("You can't suspend your own account.");
    }
    const target = await this.prisma.user.findUnique({ where: { id: userId } });
    const outOfScope = partnerId ? target?.role !== "PARTNER_STAFF" : target?.role === "SUPER_ADMIN";
    if (!target || isVendorRole(target.role) || target.partnerId !== partnerId || outOfScope) {
      throw Errors.notFound();
    }
    await this.prisma.$transaction(async (tx) => {
      await tx.user.update({ where: { id: userId }, data: { status: "SUSPENDED" } });
      await this.audit.record(
        { actor: { userId: principal.userId, role: principal.role }, action: "staff.suspended", resourceType: "user", resourceId: userId, countryCode: target.countryCode, meta },
        tx,
      );
      await this.sessions.revokeAllForUser(userId, "suspended", tx);
    });
  }

  async preview(token: string): Promise<StaffInvitationPreview> {
    const invitation = await this.prisma.staffInvitation.findFirst({ where: this.usable(token), include: { partner: { select: { legalName: true } } } });
    if (!invitation) {
      throw Errors.invalidCode();
    }
    return { email: invitation.email, role: invitation.role as InvitedRole, countryCode: invitation.countryCode, partnerName: invitation.partner?.legalName ?? null };
  }

  async accept(input: AcceptInvitationInput, meta: RequestMeta): Promise<IssuedAuthentication> {
    const passwordHash = await this.passwords.hashNew(input.password);
    let userId: string;
    try {
      userId = await this.prisma.$transaction(async (tx) => {
        const candidate = await tx.staffInvitation.findFirst({ where: this.usable(input.token), select: { id: true, partnerId: true } });
        if (candidate?.partnerId) {
          await lockRow(tx, "fulfilmentPartners", candidate.partnerId);
          const partner = await tx.fulfilmentPartner.findUniqueOrThrow({ where: { id: candidate.partnerId }, select: { status: true } });
          if (partner.status === "TERMINATED" || partner.status === "REJECTED") {
            throw Errors.invalidCode();
          }
          if (partner.status === "APPLIED") {
            await tx.fulfilmentPartner.update({ where: { id: candidate.partnerId }, data: { status: "VERIFYING" } });
          }
        }
        const invitation = candidate && (await lockRow(tx, "staffInvitations", candidate.id)) ? await tx.staffInvitation.findFirst({ where: { ...this.usable(input.token), id: candidate.id } }) : null;
        if (!invitation) {
          throw Errors.invalidCode();
        }
        const user = await tx.user.create({
          data: { email: invitation.email, passwordHash, role: invitation.role, countryCode: invitation.countryCode, partnerId: invitation.partnerId, status: "ACTIVE", emailVerifiedAt: new Date() },
          select: { id: true },
        });
        await tx.staffInvitation.update({ where: { id: invitation.id }, data: { status: "ACCEPTED", acceptedAt: new Date() } });
        await this.audit.record(
          {
            actor: { userId: user.id, role: invitation.role },
            action: "staff.invitation_accepted",
            resourceType: "staff_invitation",
            resourceId: invitation.id,
            countryCode: invitation.countryCode,
            meta,
          },
          tx,
        );
        return user.id;
      });
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw Errors.invalidTransition("This email already has an account. Sign in instead.");
      }
      throw error;
    }
    return this.issuer.start(userId, "ENROLMENT_REQUIRED", meta);
  }

  private tokenHash(token: string): string {
    return this.hasher.keyedHash(`staff-invitation:${token}`);
  }

  private usable(token: string): Prisma.StaffInvitationWhereInput {
    return { tokenHash: this.tokenHash(token), status: "PENDING", expiresAt: { gt: new Date() } };
  }
}
