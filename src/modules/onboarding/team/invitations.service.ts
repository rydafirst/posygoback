import { Injectable } from "@nestjs/common";

import type { RequestMeta } from "../../../common/auth/auth-principal";
import { Errors } from "../../../common/http/app-exception";
import { isUniqueViolation, lockRow, PrismaService } from "../../../database/prisma.service";
import type { Prisma } from "../../../generated/prisma/client";
import { AuditService } from "../../../infrastructure/audit/audit.service";
import { SecretHasherService } from "../../../infrastructure/crypto/secret-hasher.service";
import type { AcceptInvitationInput, InvitationPreview } from "../../../shared";
import { PasswordService } from "../../auth/password/password.service";
import { type IssuedAuthentication, SessionIssuerService } from "../../auth/sessions/session-issuer.service";
import { MAX_TEAM_SIZE } from "./team-policy";

@Injectable()
export class InvitationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly hasher: SecretHasherService,
    private readonly passwords: PasswordService,
    private readonly issuer: SessionIssuerService,
    private readonly audit: AuditService,
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
    let userId: string;
    try {
      userId = await this.prisma.$transaction(async (tx) => {
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
        return user.id;
      });
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw Errors.invalidTransition("This email already has an account. Sign in instead, or ask for an invite to a different email.");
      }
      throw error;
    }
    return this.issuer.start(userId, "NOT_REQUIRED", meta);
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
