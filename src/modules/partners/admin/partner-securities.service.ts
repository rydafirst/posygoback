import { Injectable } from "@nestjs/common";

import type { AuthPrincipal, RequestMeta } from "../../../common/auth/auth-principal";
import { Errors } from "../../../common/http/app-exception";
import { lockRow, PrismaService } from "../../../database/prisma.service";
import { AuditService } from "../../../infrastructure/audit/audit.service";
import { Money, type PartnerDetailView, type PartnerStatus, type RecordSecurityInput } from "../../../shared";
import { PartnerEmails } from "../partner-emails";
import { PartnerNotifierService } from "../partner-notifier.service";
import { actorOf, AdminPartnersService } from "./admin-partners.service";

const SECURITY_LOCKED: readonly PartnerStatus[] = ["ACTIVE", "SUSPENDED", "OFFBOARDING"];

@Injectable()
export class PartnerSecuritiesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly admin: AdminPartnersService,
    private readonly notifier: PartnerNotifierService,
    private readonly audit: AuditService,
  ) {}

  async recordSecurity(principal: AuthPrincipal, partnerId: string, input: RecordSecurityInput, meta: RequestMeta): Promise<PartnerDetailView> {
    const partner = await this.admin.scoped(principal, partnerId);
    if (partner.status === "TERMINATED" || partner.status === "REJECTED") {
      throw Errors.invalidTransition("This partnership is closed.");
    }
    const currency = (await this.prisma.country.findUniqueOrThrow({ where: { code: partner.countryCode }, select: { currency: true } })).currency;
    await this.prisma.$transaction(async (tx) => {
      const security = await tx.partnerSecurity.create({
        data: {
          partnerId,
          kind: input.kind,
          amountMinor: BigInt(input.amountMinor),
          currency,
          reference: input.reference,
          expiresOn: input.expiresOn ? new Date(`${input.expiresOn}T00:00:00Z`) : null,
          recordedBy: principal.userId,
        },
      });
      await this.audit.record(
        {
          actor: actorOf(principal),
          action: "partner.security_recorded",
          resourceType: "partner_security",
          resourceId: security.id,
          countryCode: partner.countryCode,
          after: { kind: input.kind, amountMinor: input.amountMinor, reference: input.reference },
          meta,
        },
        tx,
      );
    });
    return this.admin.detail(principal, partnerId);
  }

  async confirmSecurity(principal: AuthPrincipal, partnerId: string, securityId: string, meta: RequestMeta): Promise<PartnerDetailView> {
    const partner = await this.admin.scoped(principal, partnerId);
    const security = await this.prisma.$transaction(async (tx) => {
      const current = await tx.partnerSecurity.findFirst({ where: { id: securityId, partnerId, releasedAt: null } });
      if (!current) {
        throw Errors.notFound();
      }
      if (current.recordedBy === principal.userId) {
        throw Errors.forbidden("Someone else must confirm a deposit you recorded.");
      }
      const confirmed = await tx.partnerSecurity.updateMany({ where: { id: securityId, confirmedAt: null }, data: { confirmedBy: principal.userId, confirmedAt: new Date() } });
      if (confirmed.count === 0) {
        throw Errors.invalidTransition("This has already been confirmed.");
      }
      await this.audit.record(
        { actor: actorOf(principal), action: "partner.security_confirmed", resourceType: "partner_security", resourceId: securityId, countryCode: partner.countryCode, meta },
        tx,
      );
      return current;
    });
    const amount = Money.of(Number(security.amountMinor), security.currency).format("en-GB");
    await this.notifier.notify(partnerId, (to, webUrl) => PartnerEmails.securityConfirmed(to, security.kind, amount, webUrl));
    return this.admin.detail(principal, partnerId);
  }

  async releaseSecurity(principal: AuthPrincipal, partnerId: string, securityId: string, note: string, meta: RequestMeta): Promise<PartnerDetailView> {
    const partner = await this.admin.scoped(principal, partnerId);
    const security = await this.prisma.$transaction(async (tx) => {
      await lockRow(tx, "fulfilmentPartners", partnerId);
      const current = await tx.fulfilmentPartner.findUniqueOrThrow({ where: { id: partnerId }, select: { status: true } });
      if (SECURITY_LOCKED.includes(current.status)) {
        throw Errors.invalidTransition("Deposits and bonds stay held while the partner is operating or offboarding.");
      }
      const security = await tx.partnerSecurity.findFirst({ where: { id: securityId, partnerId, releasedAt: null }, include: { draws: { select: { amountMinor: true } } } });
      if (!security) {
        throw Errors.notFound();
      }
      if (security.recordedBy === principal.userId) {
        throw Errors.forbidden("Someone else must release a deposit you recorded.");
      }
      await tx.partnerSecurity.update({ where: { id: securityId }, data: { releasedAt: new Date(), releasedBy: principal.userId, releaseNote: note } });
      await this.audit.record(
        { actor: actorOf(principal), action: "partner.security_released", resourceType: "partner_security", resourceId: securityId, countryCode: partner.countryCode, after: { note }, meta },
        tx,
      );
      return security;
    });
    const format = (minor: number) => Money.of(minor, security.currency).format("en-GB");
    const drawn = security.draws.reduce((total, draw) => total + Number(draw.amountMinor), 0);
    await this.notifier.notify(partnerId, (to) => PartnerEmails.securityReleased(to, security.kind, format(Number(security.amountMinor)), drawn > 0 ? format(drawn) : null));
    return this.admin.detail(principal, partnerId);
  }
}
