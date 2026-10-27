import { Inject, Injectable, type OnModuleInit } from "@nestjs/common";

import type { AuthPrincipal, RequestMeta } from "../../../common/auth/auth-principal";
import { APP_CONFIG } from "../../../config/config.module";
import type { AppConfig } from "../../../config/config.schema";
import { PrismaService } from "../../../database/prisma.service";
import { AuditService, SYSTEM_ACTOR } from "../../../infrastructure/audit/audit.service";
import { WalletAlertsService } from "../../finance/wallets/wallet-alerts.service";
import { vendorIdOf } from "../../onboarding/scope";
import { ConnectAccountEvents } from "../../partners/providers/connect-account-events";
import { PAYOUT_GATEWAY, type PayoutGateway } from "../../partners/providers/partner-services.port";
import { CommerceEmails } from "../commerce-emails";

@Injectable()
export class VendorPayoutAccountService implements OnModuleInit {
  constructor(
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    @Inject(PAYOUT_GATEWAY) private readonly gateway: PayoutGateway,
    private readonly prisma: PrismaService,
    private readonly accountEvents: ConnectAccountEvents,
    private readonly owners: WalletAlertsService,
    private readonly audit: AuditService,
  ) {}

  onModuleInit(): void {
    this.accountEvents.subscribe((accountId) => this.sync(accountId));
  }

  async startSetup(principal: AuthPrincipal, meta: RequestMeta): Promise<{ url: string }> {
    const vendorId = vendorIdOf(principal);
    const vendor = await this.prisma.vendor.findUniqueOrThrow({ where: { id: vendorId }, include: { payoutAccount: true } });
    let accountId = vendor.payoutAccount?.providerAccountId;
    if (!accountId) {
      const owner = await this.prisma.user.findFirstOrThrow({ where: { vendorId, role: "VENDOR_OWNER" }, select: { email: true } });
      accountId = await this.gateway.createAccount({ ownerType: "VENDOR", ownerId: vendorId, email: owner.email, countryCode: vendor.countryCode });
      await this.prisma.vendorPayoutAccount.createMany({ data: [{ vendorId, provider: this.gateway.provider, providerAccountId: accountId }], skipDuplicates: true });
      await this.audit.record({ actor: { userId: principal.userId, role: principal.role }, action: "storefront.payout_setup_started", resourceType: "vendor", resourceId: vendorId, vendorId, meta });
    }
    return { url: await this.gateway.onboardingLink(accountId, `${this.config.WEB_PUBLIC_URL}/storefront?payouts=returned`) };
  }

  async refreshOwn(principal: AuthPrincipal): Promise<void> {
    const account = await this.prisma.vendorPayoutAccount.findUnique({ where: { vendorId: vendorIdOf(principal) } });
    if (account) {
      await this.sync(account.providerAccountId);
    }
  }

  async sync(providerAccountId: string): Promise<void> {
    const account = await this.prisma.vendorPayoutAccount.findUnique({ where: { provider_providerAccountId: { provider: this.gateway.provider, providerAccountId } } });
    if (!account) {
      return;
    }
    const snapshot = await this.gateway.fetchAccount(providerAccountId);
    const bankChanged = snapshot.bankFingerprint !== account.bankFingerprint && (account.bankFingerprint !== null || account.status !== "ONBOARDING");
    await this.prisma.vendorPayoutAccount.update({
      where: { vendorId: account.vendorId },
      data: {
        status: snapshot.payoutsEnabled ? "ACTIVE" : account.status === "ONBOARDING" ? "ONBOARDING" : "RESTRICTED",
        bankSummary: snapshot.bankSummary,
        bankFingerprint: snapshot.bankFingerprint,
        detailsChangedAt: bankChanged ? new Date() : account.detailsChangedAt,
      },
    });
    if (bankChanged) {
      await this.audit.record({
        actor: SYSTEM_ACTOR,
        action: "storefront.payout_bank_changed",
        resourceType: "vendor",
        resourceId: account.vendorId,
        vendorId: account.vendorId,
        after: { bankSummary: snapshot.bankSummary },
      });
      await this.owners.notifyOwner(account.vendorId, (to) => CommerceEmails.payoutBankChanged(to, snapshot.bankSummary ?? "a new account", this.config.WEB_PUBLIC_URL), "/storefront");
    }
  }
}
