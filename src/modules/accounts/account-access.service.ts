import { Inject, Injectable } from "@nestjs/common";

import type { AuthPrincipal, RequestMeta } from "../../common/auth/auth-principal";
import { Errors } from "../../common/http/app-exception";
import { APP_CONFIG } from "../../config/config.module";
import type { AppConfig } from "../../config/config.schema";
import { lockRow, PrismaService } from "../../database/prisma.service";
import type { Prisma } from "../../generated/prisma/client";
import { AuditService } from "../../infrastructure/audit/audit.service";
import { EMAIL_SENDER, type EmailMessage, type EmailSender } from "../../infrastructure/email/email.port";
import { SessionService } from "../auth/sessions/session.service";
import { VendorActivationService } from "../onboarding/vendor-activation.service";
import { AccountEmails } from "./account-emails";

type AccountOwner = { vendorId: string } | { partnerId: string };

@Injectable()
export class AccountAccessService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly sessions: SessionService,
    private readonly activation: VendorActivationService,
    private readonly audit: AuditService,
    @Inject(EMAIL_SENDER) private readonly email: EmailSender,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  async deactivateVendor(principal: AuthPrincipal, vendorId: string, reason: string, meta: RequestMeta): Promise<void> {
    const vendor = await this.prisma.$transaction(async (tx) => {
      const current = await this.lockedVendor(tx, vendorId);
      if (current.deactivatedAt) {
        throw Errors.invalidTransition("This account is already deactivated.");
      }
      await tx.vendor.update({ where: { id: vendorId }, data: { status: "SUSPENDED", deactivatedAt: new Date(), statusBeforeDeactivation: current.status } });
      await tx.vendorInvitation.updateMany({ where: { vendorId, status: "PENDING" }, data: { status: "REVOKED", revokedAt: new Date() } });
      await this.signOutEveryone(tx, { vendorId });
      await this.record(tx, principal, meta, "vendor.deactivated", "vendor", current, { status: current.status }, { status: "SUSPENDED", reason });
      return current;
    });
    await this.tell(await this.vendorOwnerEmail(vendorId), (to) => AccountEmails.deactivated(to, vendor.businessName));
  }

  async reactivateVendor(principal: AuthPrincipal, vendorId: string, reason: string, meta: RequestMeta): Promise<void> {
    const vendor = await this.prisma.$transaction(async (tx) => {
      const current = await this.lockedVendor(tx, vendorId);
      if (!current.deactivatedAt) {
        throw Errors.invalidTransition("This account is already active.");
      }
      const status = current.statusBeforeDeactivation ?? "PENDING_VERIFICATION";
      await tx.vendor.update({ where: { id: vendorId }, data: { status, deactivatedAt: null, statusBeforeDeactivation: null } });
      if (status === "PENDING_VERIFICATION") {
        await this.activation.refresh(vendorId, current.countryCode, tx);
      }
      await this.record(tx, principal, meta, "vendor.reactivated", "vendor", current, { status: current.status }, { status, reason });
      return current;
    });
    await this.tell(await this.vendorOwnerEmail(vendorId), (to) => AccountEmails.reactivated(to, vendor.businessName, this.signInUrl()));
  }

  async deactivatePartner(principal: AuthPrincipal, partnerId: string, reason: string, meta: RequestMeta): Promise<void> {
    const partner = await this.prisma.$transaction(async (tx) => {
      const current = await this.lockedPartner(tx, partnerId);
      if (current.deactivatedAt) {
        throw Errors.invalidTransition("This account is already deactivated.");
      }
      const status = current.status === "ACTIVE" ? "SUSPENDED" : current.status;
      await tx.fulfilmentPartner.update({
        where: { id: partnerId },
        data: { status, statusReason: status === current.status ? undefined : reason, deactivatedAt: new Date(), statusBeforeDeactivation: current.status },
      });
      await tx.staffInvitation.updateMany({ where: { partnerId, status: "PENDING" }, data: { status: "REVOKED", revokedAt: new Date() } });
      await this.signOutEveryone(tx, { partnerId });
      await this.record(tx, principal, meta, "partner.deactivated", "fulfilment_partner", current, { status: current.status }, { status, reason });
      return current;
    });
    await this.tell(partner.contactEmail, (to) => AccountEmails.deactivated(to, partner.legalName));
  }

  async reactivatePartner(principal: AuthPrincipal, partnerId: string, reason: string, meta: RequestMeta): Promise<void> {
    const partner = await this.prisma.$transaction(async (tx) => {
      const current = await this.lockedPartner(tx, partnerId);
      if (!current.deactivatedAt) {
        throw Errors.invalidTransition("This account is already active.");
      }
      const resumes = current.status === "SUSPENDED" && current.statusBeforeDeactivation === "ACTIVE";
      const status = resumes ? "ACTIVE" : current.status;
      await tx.fulfilmentPartner.update({ where: { id: partnerId }, data: { status, statusReason: resumes ? null : undefined, deactivatedAt: null, statusBeforeDeactivation: null } });
      await this.record(tx, principal, meta, "partner.reactivated", "fulfilment_partner", current, { status: current.status }, { status, reason });
      return current;
    });
    await this.tell(partner.contactEmail, (to) => AccountEmails.reactivated(to, partner.legalName, this.signInUrl()));
  }

  private async lockedVendor(tx: Prisma.TransactionClient, vendorId: string) {
    if (!(await lockRow(tx, "vendors", vendorId))) {
      throw Errors.notFound();
    }
    return tx.vendor.findUniqueOrThrow({ where: { id: vendorId } });
  }

  private async lockedPartner(tx: Prisma.TransactionClient, partnerId: string) {
    if (!(await lockRow(tx, "fulfilmentPartners", partnerId))) {
      throw Errors.notFound();
    }
    return tx.fulfilmentPartner.findUniqueOrThrow({ where: { id: partnerId } });
  }

  private async signOutEveryone(tx: Prisma.TransactionClient, owner: AccountOwner): Promise<void> {
    const users = await tx.user.findMany({ where: owner, select: { id: true } });
    for (const user of users) {
      await this.sessions.revokeAllForUser(user.id, "account_deactivated", tx);
    }
  }

  private record(
    tx: Prisma.TransactionClient,
    principal: AuthPrincipal,
    meta: RequestMeta,
    action: string,
    resourceType: string,
    account: { id: string; countryCode: string },
    before: Record<string, unknown>,
    after: Record<string, unknown>,
  ): Promise<void> {
    return this.audit.record(
      {
        actor: { userId: principal.userId, role: principal.role },
        action,
        resourceType,
        resourceId: account.id,
        vendorId: resourceType === "vendor" ? account.id : undefined,
        countryCode: account.countryCode,
        before,
        after,
        meta,
      },
      tx,
    );
  }

  private async vendorOwnerEmail(vendorId: string): Promise<string | null> {
    const owner = await this.prisma.user.findFirst({ where: { vendorId, role: "VENDOR_OWNER" }, select: { email: true } });
    return owner?.email ?? null;
  }

  private async tell(to: string | null, message: (to: string) => EmailMessage): Promise<void> {
    if (to) {
      await this.email.send(message(to)).catch(() => undefined);
    }
  }

  private signInUrl(): string {
    return new URL("/login", this.config.WEB_PUBLIC_URL).toString();
  }
}
