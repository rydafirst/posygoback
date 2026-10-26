import { Injectable } from "@nestjs/common";

import type { AuthPrincipal, RequestMeta } from "../../../common/auth/auth-principal";
import { Errors } from "../../../common/http/app-exception";
import { isUniqueViolation, lockRow, PrismaService } from "../../../database/prisma.service";
import { AuditService } from "../../../infrastructure/audit/audit.service";
import { type StorefrontSettingsInput, type StorefrontSettingsView, type StorefrontTone, storefrontRates } from "../../../shared";
import { FeeSchedulesService } from "../../finance/fees/fee-schedules.service";
import { WalletAlertsService } from "../../finance/wallets/wallet-alerts.service";
import { WalletLedgerService } from "../../finance/wallets/wallet-ledger.service";
import { vendorIdOf } from "../../onboarding/scope";
import { VendorStandingService } from "../../onboarding/vendor-standing.service";

const actorOf = (principal: AuthPrincipal) => ({ userId: principal.userId, role: principal.role });

@Injectable()
export class StorefrontSettingsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly standing: VendorStandingService,
    private readonly fees: FeeSchedulesService,
    private readonly ledger: WalletLedgerService,
    private readonly alerts: WalletAlertsService,
    private readonly audit: AuditService,
  ) {}

  async view(principal: AuthPrincipal): Promise<StorefrontSettingsView> {
    const vendorId = vendorIdOf(principal);
    const vendor = await this.prisma.vendor.findUniqueOrThrow({ where: { id: vendorId }, include: { storefront: true, payoutAccount: true, country: { select: { currency: true } } } });
    const rates = storefrontRates((await this.fees.active(vendor.countryCode)).schedule);
    const listedProducts = await this.prisma.product.count({ where: { vendorId, listed: true, status: "ACTIVE" } });
    const store = vendor.storefront;
    const payout = vendor.payoutAccount;
    const missing = [
      ...(store ? [] : ["Choose your store name and address"]),
      ...(listedProducts > 0 ? [] : ["List at least one product with a price"]),
      ...(payout?.status === "ACTIVE" ? [] : ["Connect a bank account for your sales"]),
    ];
    return {
      slug: store?.slug ?? null,
      displayName: store?.displayName ?? vendor.businessName,
      about: store?.about ?? null,
      tone: (store?.tone ?? "lime") as StorefrontTone,
      status: store?.status ?? "DRAFT",
      returnsAllowed: store?.returnsAllowed ?? true,
      returnWindowDays: store?.returnWindowDays ?? 30,
      setupFeePaid: Boolean(store?.setupFeePaidAt),
      setupFeeMinor: rates.setupFeeMinor,
      commissionBps: rates.commissionBps,
      currency: vendor.country.currency,
      listedProducts,
      payoutAccount: payout ? { provider: payout.provider, status: payout.status, bankSummary: payout.bankSummary } : null,
      missing,
    };
  }

  async save(principal: AuthPrincipal, input: StorefrontSettingsInput, meta: RequestMeta): Promise<StorefrontSettingsView> {
    const vendorId = vendorIdOf(principal);
    const data = { slug: input.slug, displayName: input.displayName, about: input.about || null, tone: input.tone, returnsAllowed: input.returnsAllowed, returnWindowDays: input.returnWindowDays };
    try {
      await this.prisma.storefront.upsert({ where: { vendorId }, create: { vendorId, ...data }, update: data });
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw Errors.validation({ slug: ["That store address is taken. Try another"] });
      }
      throw error;
    }
    await this.audit.record({ actor: actorOf(principal), action: "storefront.saved", resourceType: "storefront", resourceId: vendorId, vendorId, after: data, meta });
    return this.view(principal);
  }

  async goLive(principal: AuthPrincipal, meta: RequestMeta): Promise<StorefrontSettingsView> {
    const vendor = await this.standing.assertCanTrade(principal);
    const current = await this.view(principal);
    if (current.missing.length > 0) {
      throw Errors.invalidTransition(`Still needed: ${current.missing.join(", ").toLowerCase()}.`);
    }
    const posting = await this.prisma.$transaction(async (tx) => {
      await lockRow(tx, "vendors", vendor.vendorId);
      const store = await tx.storefront.findUniqueOrThrow({ where: { vendorId: vendor.vendorId } });
      let charged = null;
      if (!store.setupFeePaidAt && current.setupFeeMinor > 0) {
        const wallet = await this.ledger.walletFor(tx, vendor.vendorId, current.currency);
        charged = await this.ledger.post(tx, wallet.id, {
          type: "STOREFRONT_FEE",
          amountMinor: current.setupFeeMinor,
          description: "One-time storefront set-up",
          idempotencyKey: `storefront-setup:${vendor.vendorId}`,
          reference: { type: "storefront", id: vendor.vendorId },
          actorId: principal.userId,
        });
      }
      await tx.storefront.update({ where: { vendorId: vendor.vendorId }, data: { status: "LIVE", setupFeePaidAt: store.setupFeePaidAt ?? new Date() } });
      await this.audit.record(
        { actor: actorOf(principal), action: "storefront.live", resourceType: "storefront", resourceId: vendor.vendorId, vendorId: vendor.vendorId, countryCode: vendor.countryCode, meta },
        tx,
      );
      return charged;
    });
    if (posting) {
      await this.alerts.afterPosting(posting);
    }
    return this.view(principal);
  }

  async pause(principal: AuthPrincipal, meta: RequestMeta): Promise<StorefrontSettingsView> {
    const vendorId = vendorIdOf(principal);
    const paused = await this.prisma.storefront.updateMany({ where: { vendorId, status: "LIVE" }, data: { status: "PAUSED" } });
    if (paused.count === 0) {
      throw Errors.invalidTransition("Your store isn't live.");
    }
    await this.audit.record({ actor: actorOf(principal), action: "storefront.paused", resourceType: "storefront", resourceId: vendorId, vendorId, meta });
    return this.view(principal);
  }
}
