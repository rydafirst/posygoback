import { Inject, Injectable, Logger, type OnApplicationBootstrap } from "@nestjs/common";

import type { AuthPrincipal, RequestMeta } from "../../../common/auth/auth-principal";
import { APP_CONFIG } from "../../../config/config.module";
import type { AppConfig } from "../../../config/config.schema";
import { lockRow, PrismaService } from "../../../database/prisma.service";
import { AuditService, SYSTEM_ACTOR } from "../../../infrastructure/audit/audit.service";
import { CLOSED_PARTNER_STATUSES, wasApproved } from "../../../shared";
import { actorOf } from "../admin/admin-partners.service";
import { PartnerLedgerService } from "../ledger/partner-ledger.service";
import { PartnerEmails } from "../partner-emails";
import { PartnerNotifierService } from "../partner-notifier.service";
import { ConnectAccountEvents } from "../providers/connect-account-events";
import { FRESH_PAYOUT_ACCOUNT, PAYOUT_GATEWAY, type PayoutGateway } from "../providers/partner-services.port";
import { OPEN_PARTNER_STATUSES, PartnerAccessService, partnerIdOf } from "./partner-access.service";

const PAYOUTS_IN_FLIGHT = ["PENDING_APPROVAL", "PROCESSING"] as const;

@Injectable()
export class PartnerPayoutAccountService implements OnApplicationBootstrap {
  private readonly logger = new Logger(PartnerPayoutAccountService.name);

  constructor(
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    @Inject(PAYOUT_GATEWAY) private readonly gateway: PayoutGateway,
    private readonly prisma: PrismaService,
    private readonly access: PartnerAccessService,
    private readonly notifier: PartnerNotifierService,
    private readonly accountEvents: ConnectAccountEvents,
    private readonly ledger: PartnerLedgerService,
    private readonly audit: AuditService,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    await this.prisma.partnerPayoutAccount.updateMany({ where: { mode: { not: this.gateway.mode }, status: { notIn: ["ONBOARDING", "CLOSED"] } }, data: { status: "ONBOARDING" } });
  }

  async startSetup(principal: AuthPrincipal, meta: RequestMeta): Promise<{ url: string }> {
    const partner = await this.access.current(principal);
    const existing = await this.prisma.partnerPayoutAccount.findUnique({ where: { partnerId: partner.id } });
    const current = existing?.mode === this.gateway.mode ? existing.providerAccountId : null;
    const accountId = current ?? (await this.gateway.createAccount({ ownerType: "PARTNER", ownerId: partner.id, email: partner.contactEmail, countryCode: partner.countryCode }));
    if (!current) {
      await this.access.mutate(principal, OPEN_PARTNER_STATUSES, "This partnership is closed.", async (tx) => {
        const account = { provider: this.gateway.provider, providerAccountId: accountId, mode: this.gateway.mode };
        if (existing) {
          await tx.partnerPayoutAccount.update({ where: { partnerId: partner.id }, data: { ...account, ...FRESH_PAYOUT_ACCOUNT } });
        } else {
          await tx.partnerPayoutAccount.createMany({ data: [{ partnerId: partner.id, ...account }], skipDuplicates: true });
        }
        await this.audit.record(
          {
            actor: actorOf(principal),
            action: existing ? "partner.payout_account_replaced" : "partner.payout_setup_started",
            resourceType: "fulfilment_partner",
            resourceId: partner.id,
            countryCode: partner.countryCode,
            meta,
          },
          tx,
        );
      });
    }
    const page = wasApproved(partner.status) ? "/admin/partnership/account" : "/admin/partnership";
    return { url: await this.gateway.setupLink(accountId, `${this.config.WEB_PUBLIC_URL}${page}?payouts=returned`) };
  }

  async refreshOwn(principal: AuthPrincipal): Promise<void> {
    const account = await this.prisma.partnerPayoutAccount.findUnique({ where: { partnerId: partnerIdOf(principal) } });
    if (account?.mode === this.gateway.mode) {
      await this.sync(account.providerAccountId);
    }
  }

  async webhook(rawBody: Buffer, signature: string): Promise<void> {
    const accountId = this.gateway.parseWebhook(rawBody, signature);
    if (accountId) {
      await this.sync(accountId);
      await this.accountEvents.publish(accountId);
    }
  }

  async closeSettled(): Promise<number> {
    const accounts = await this.prisma.partnerPayoutAccount.findMany({
      where: { mode: this.gateway.mode, status: { not: "CLOSED" }, partner: { status: { in: [...CLOSED_PARTNER_STATUSES] } } },
      select: { partnerId: true, providerAccountId: true },
    });
    let closed = 0;
    for (const account of accounts) {
      if (await this.isSettled(account.partnerId)) {
        closed += (await this.close(account.partnerId, account.providerAccountId)) ? 1 : 0;
      }
    }
    return closed;
  }

  private async isSettled(partnerId: string): Promise<boolean> {
    const { availableMinor, heldMinor } = await this.ledger.balances(this.prisma, partnerId);
    const inFlight = await this.prisma.partnerPayout.count({ where: { partnerId, status: { in: [...PAYOUTS_IN_FLIGHT] } } });
    return availableMinor <= 0 && heldMinor === 0 && inFlight === 0;
  }

  private async close(partnerId: string, providerAccountId: string): Promise<boolean> {
    try {
      await this.gateway.closeAccount(providerAccountId);
    } catch (error) {
      this.logger.error(`Could not close the payout account of partner ${partnerId}: ${String(error)}`);
      return false;
    }
    await this.prisma.$transaction(async (tx) => {
      await tx.partnerPayoutAccount.update({ where: { partnerId }, data: { status: "CLOSED" } });
      await this.audit.record({ actor: SYSTEM_ACTOR, action: "partner.payout_account_closed", resourceType: "fulfilment_partner", resourceId: partnerId }, tx);
    });
    return true;
  }

  async sync(providerAccountId: string): Promise<void> {
    const open = await this.prisma.partnerPayoutAccount.findUnique({ where: { provider_providerAccountId: { provider: this.gateway.provider, providerAccountId } }, select: { status: true } });
    if (open?.status === "CLOSED") {
      return;
    }
    const snapshot = await this.gateway.fetchAccount(providerAccountId);
    const changed = await this.prisma.$transaction(async (tx) => {
      const account = await tx.partnerPayoutAccount.findUnique({ where: { provider_providerAccountId: { provider: this.gateway.provider, providerAccountId } } });
      if (!account || account.status === "CLOSED") {
        return null;
      }
      await lockRow(tx, "fulfilmentPartners", account.partnerId);
      const bankChanged = snapshot.bankFingerprint !== account.bankFingerprint && (account.bankFingerprint !== null || account.detailsChangedAt !== null || account.status !== "ONBOARDING");
      await tx.partnerPayoutAccount.update({
        where: { partnerId: account.partnerId },
        data: {
          status: snapshot.payoutsEnabled ? "ACTIVE" : account.status === "ONBOARDING" ? "ONBOARDING" : "RESTRICTED",
          bankSummary: snapshot.bankSummary,
          bankFingerprint: snapshot.bankFingerprint,
          detailsChangedAt: bankChanged ? new Date() : account.detailsChangedAt,
        },
      });
      if (bankChanged) {
        await this.audit.record(
          { actor: SYSTEM_ACTOR, action: "partner.payout_bank_changed", resourceType: "fulfilment_partner", resourceId: account.partnerId, after: { bankSummary: snapshot.bankSummary } },
          tx,
        );
      }
      return bankChanged ? { partnerId: account.partnerId, bankSummary: snapshot.bankSummary ?? "a new account" } : null;
    });
    if (changed) {
      await this.notifier.notify(changed.partnerId, (to, webUrl) => PartnerEmails.payoutAccountChanged(to, changed.bankSummary, webUrl));
    }
  }
}
