import { Inject, Injectable } from "@nestjs/common";

import type { RequestMeta } from "../../../common/auth/auth-principal";
import { Errors } from "../../../common/http/app-exception";
import { APP_CONFIG } from "../../../config/config.module";
import type { AppConfig } from "../../../config/config.schema";
import { isUniqueViolation, lockRow, PrismaService } from "../../../database/prisma.service";
import type { Prisma } from "../../../generated/prisma/client";
import { AuditService } from "../../../infrastructure/audit/audit.service";
import { SecretHasherService } from "../../../infrastructure/crypto/secret-hasher.service";
import { EMAIL_SENDER, type EmailSender } from "../../../infrastructure/email/email.port";
import type { AcceptInvitationInput, InvitationPreview } from "../../../shared";
import { PasswordService } from "../../auth/password/password.service";
import { type IssuedAuthentication, SessionIssuerService } from "../../auth/sessions/session-issuer.service";
import { UsersRepository } from "../../auth/users.repository";
import { OnboardingEmails } from "../onboarding-emails";
import { MAX_TEAM_SIZE } from "./team-policy";

@Injectable()
export class InvitationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly hasher: SecretHasherService,
    private readonly passwords: PasswordService,
    private readonly issuer: SessionIssuerService,
    private readonly audit: AuditService,
    private readonly users: UsersRepository,
    @Inject(EMAIL_SENDER) private readonly email: EmailSender,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  async preview(token: string): Promise<InvitationPreview> {
    const invitation = await this.prisma.vendorInvitation.findFirst({ where: this.usable(token), include: { vendor: { select: { businessName: true } } } });
    if (!invitation) {
      throw Errors.invalidCode();
    }
    return { email: invitation.email, businessName: invitation.vendor.businessName };
  }

  async accept(input: AcceptInvitationInput, meta: RequestMeta): Promise<IssuedAuthentication> {
    const passwordHash = await this.passwords.hashNew(input.password);
    let joined: { userId: string; email: string; vendorId: string };
    try {
      joined = await this.prisma.$transaction(async (tx) => {
        const invitation = await this.lockUsable(tx, input.token);
        const vendor = invitation && (await lockRow(tx, "vendors", invitation.vendorId)) ? await tx.vendor.findUnique({ where: { id: invitation.vendorId } }) : null;
        if (!invitation || !vendor || vendor.status === "SUSPENDED" || vendor.status === "CLOSED") {
          throw Errors.invalidCode();
        }
        if ((await tx.user.count({ where: { vendorId: vendor.id } })) >= MAX_TEAM_SIZE) {
          throw Errors.invalidTransition(`This team already has ${MAX_TEAM_SIZE} people. Ask the owner to make room first.`);
        }
        const user = await tx.user.create({
          data: { email: invitation.email, passwordHash, role: "VENDOR_MEMBER", vendorId: vendor.id, countryCode: vendor.countryCode, status: "ACTIVE", emailVerifiedAt: new Date() },
          select: { id: true },
        });
        await tx.vendorInvitation.update({ where: { id: invitation.id }, data: { status: "ACCEPTED", acceptedAt: new Date() } });
        await this.audit.record(
          {
            actor: { userId: user.id, role: "VENDOR_MEMBER" },
            action: "team.invitation_accepted",
            resourceType: "vendor_invitation",
            resourceId: invitation.id,
            vendorId: vendor.id,
            countryCode: vendor.countryCode,
            meta,
          },
          tx,
        );
        return { userId: user.id, email: invitation.email, vendorId: vendor.id };
      });
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw Errors.invalidTransition("This email already has an account. Sign in instead, or ask for an invite to a different email.");
      }
      throw error;
    }
    await this.tellOwner(joined.vendorId, joined.email);
    return this.issuer.start(joined.userId, "NOT_REQUIRED", meta);
  }

  private async tellOwner(vendorId: string, memberEmail: string): Promise<void> {
    const owner = await this.users.findVendorOwner(vendorId);
    if (owner) {
      await this.email.send(OnboardingEmails.teamMemberJoined(owner.email, memberEmail, this.config.WEB_PUBLIC_URL));
    }
  }

  private async lockUsable(tx: Prisma.TransactionClient, token: string) {
    const candidate = await tx.vendorInvitation.findFirst({ where: this.usable(token), select: { id: true } });
    if (!candidate || !(await lockRow(tx, "vendorInvitations", candidate.id))) {
      return null;
    }
    return tx.vendorInvitation.findFirst({ where: { ...this.usable(token), id: candidate.id } });
  }

  private usable(token: string): Prisma.VendorInvitationWhereInput {
    return { tokenHash: this.hasher.keyedHash(`invitation:${token}`), status: "PENDING", expiresAt: { gt: new Date() } };
  }
}
