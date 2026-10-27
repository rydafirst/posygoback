import { Inject, Injectable } from "@nestjs/common";
import type { TeamView } from "../../../shared";

import type { AuthPrincipal, RequestMeta } from "../../../common/auth/auth-principal";
import { Errors } from "../../../common/http/app-exception";
import { APP_CONFIG } from "../../../config/config.module";
import type { AppConfig } from "../../../config/config.schema";
import { lockRow, PrismaService } from "../../../database/prisma.service";
import { AuditService } from "../../../infrastructure/audit/audit.service";
import { SecretHasherService } from "../../../infrastructure/crypto/secret-hasher.service";
import { EMAIL_SENDER, type EmailSender } from "../../../infrastructure/email/email.port";
import { AttemptLimiterService } from "../../../infrastructure/rate-limit/attempt-limiter.service";
import { SessionService } from "../../auth/sessions/session.service";
import { OnboardingEmails } from "../onboarding-emails";
import { vendorIdOf } from "../scope";
import { MAX_TEAM_SIZE } from "./team-policy";

const INVITATION_DAYS = 7;
const INVITES_PER_DAY = { name: "vendor-invites", limit: 20, windowSeconds: 24 * 60 * 60 };

@Injectable()
export class TeamService {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(EMAIL_SENDER) private readonly email: EmailSender,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    private readonly hasher: SecretHasherService,
    private readonly sessions: SessionService,
    private readonly limiter: AttemptLimiterService,
    private readonly audit: AuditService,
  ) {}

  async view(principal: AuthPrincipal): Promise<TeamView> {
    const vendorId = vendorIdOf(principal);
    const members = (await this.prisma.user.findMany({ where: { vendorId }, select: { id: true, email: true, role: true, status: true, createdAt: true }, orderBy: { createdAt: "asc" } })).map(
      ({ id, createdAt, ...member }) => ({ ...member, userId: id, joinedAt: createdAt }),
    );
    const invitations = await this.prisma.vendorInvitation.findMany({ where: { vendorId, status: "PENDING" }, orderBy: { createdAt: "asc" } });
    const now = new Date();
    return {
      members: members.map((member) => ({ ...member, role: member.role === "VENDOR_OWNER" ? "VENDOR_OWNER" : "VENDOR_MEMBER", joinedAt: member.joinedAt.toISOString() })),
      invitations: invitations.map((invitation) => ({
        id: invitation.id,
        email: invitation.email,
        status: invitation.expiresAt <= now ? "EXPIRED" : "PENDING",
        expiresAt: invitation.expiresAt.toISOString(),
      })),
    };
  }

  async invite(principal: AuthPrincipal, email: string, meta: RequestMeta): Promise<void> {
    const vendorId = vendorIdOf(principal);
    await this.limiter.consume(INVITES_PER_DAY, vendorId);
    const token = this.hasher.randomToken();
    const businessName = await this.prisma.$transaction(async (tx) => {
      const vendor = (await lockRow(tx, "vendors", vendorId)) ? await tx.vendor.findUnique({ where: { id: vendorId } }) : null;
      const members = await tx.user.count({ where: { vendorId } });
      if (!vendor || members >= MAX_TEAM_SIZE) {
        throw Errors.invalidTransition(`Teams can have up to ${MAX_TEAM_SIZE} people.`);
      }
      await tx.vendorInvitation.updateMany({ where: { vendorId, email, status: "PENDING" }, data: { status: "REVOKED", revokedAt: new Date() } });
      const invitation = await tx.vendorInvitation.create({
        data: { vendorId, email, tokenHash: this.hasher.keyedHash(`invitation:${token}`), invitedBy: principal.userId, expiresAt: new Date(Date.now() + INVITATION_DAYS * 24 * 60 * 60 * 1000) },
        select: { id: true },
      });
      await this.audit.record(
        { actor: { userId: principal.userId, role: principal.role }, action: "team.invited", resourceType: "vendor_invitation", resourceId: invitation.id, vendorId, after: { email }, meta },
        tx,
      );
      return vendor.businessName;
    });
    const link = `${this.config.WEB_PUBLIC_URL}/invite#token=${encodeURIComponent(token)}`;
    await this.email.send(OnboardingEmails.teamInvitation(email, businessName, link));
  }

  async revokeInvitation(principal: AuthPrincipal, invitationId: string, meta: RequestMeta): Promise<void> {
    const vendorId = vendorIdOf(principal);
    const revoked = await this.prisma.vendorInvitation.updateMany({ where: { id: invitationId, vendorId, status: "PENDING" }, data: { status: "REVOKED", revokedAt: new Date() } });
    if (revoked.count === 0) {
      throw Errors.notFound();
    }
    await this.audit.record({
      actor: { userId: principal.userId, role: principal.role },
      action: "team.invitation_revoked",
      resourceType: "vendor_invitation",
      resourceId: invitationId,
      vendorId,
      meta,
    });
  }

  async removeMember(principal: AuthPrincipal, userId: string, meta: RequestMeta): Promise<void> {
    const vendorId = vendorIdOf(principal);
    const member = await this.prisma.user.findFirst({ where: { id: userId, vendorId, role: "VENDOR_MEMBER" }, select: { email: true, status: true, vendor: { select: { businessName: true } } } });
    const removed = await this.prisma.$transaction(async (tx) => {
      const rows = await tx.user.updateMany({ where: { id: userId, vendorId, role: "VENDOR_MEMBER" }, data: { status: "SUSPENDED" } });
      if (rows.count > 0) {
        await this.sessions.revokeAllForUser(userId, "removed_from_team", tx);
        await this.audit.record({ actor: { userId: principal.userId, role: principal.role }, action: "team.member_removed", resourceType: "user", resourceId: userId, vendorId, meta }, tx);
      }
      return rows.count > 0;
    });
    if (!removed) {
      throw Errors.notFound();
    }
    if (member?.vendor && member.status !== "SUSPENDED") {
      await this.email.send(OnboardingEmails.teamMemberRemoved(member.email, member.vendor.businessName));
    }
  }
}
