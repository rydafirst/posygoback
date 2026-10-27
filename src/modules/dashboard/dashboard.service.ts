import { Injectable } from "@nestjs/common";

import type { AuthPrincipal } from "../../common/auth/auth-principal";
import { Errors } from "../../common/http/app-exception";
import { PrismaService } from "../../database/prisma.service";
import { Prisma } from "../../generated/prisma/client";
import { type AttentionItem, type DashboardView, hasPermission, type MoneyTotal } from "../../shared";
import { STAFF_TOPICS, type StaffTopicKey } from "../notifications/staff-topics";
import { warehouseCountryScope } from "../stock/scope";

const WINDOW_MS = 30 * 24 * 60 * 60 * 1000;
const CHARGES = ["ONBOARDING", "STORAGE", "FULFILMENT", "SHIPPING", "RETURN", "RECEIVING_HOLD_FEE", "STOREFRONT_FEE"];

type Counter = (country: string | undefined) => Promise<number>;

type AttentionKey = Exclude<StaffTopicKey, "vendorJoined" | "partnerApplied" | "support">;

@Injectable()
export class DashboardService {
  private readonly counts: Record<AttentionKey, Counter>;

  constructor(private readonly prisma: PrismaService) {
    const db = this.prisma;
    this.counts = {
      verifications: (c) => db.vendorVerification.count({ where: { status: "SUBMITTED", countryCode: c } }),
      partners: (c) => db.fulfilmentPartner.count({ where: { status: "UNDER_REVIEW", countryCode: c } }),
      prices: (c) => db.feeSchedule.count({ where: { status: "PROPOSED", countryCode: c } }),
      adjustments: (c) => db.walletAdjustment.count({ where: { status: "PENDING_APPROVAL", wallet: { vendor: { countryCode: c } } } }),
      partnerPayouts: (c) => db.partnerPayout.count({ where: { status: "PENDING_APPROVAL", partner: { countryCode: c } } }),
      claimsToAssess: (c) => db.custodyClaim.count({ where: { status: "OPEN", countryCode: c } }),
      claimsToDecide: (c) => db.custodyClaim.count({ where: { status: "ASSESSED", countryCode: c } }),
      alerts: (c) => db.custodyAlert.count({ where: { status: "OPEN", countryCode: c } }),
      inbound: (c) => db.inboundShipment.count({ where: { status: { in: ["ARRIVED", "ON_HOLD"] }, countryCode: c } }),
      ordersStuck: (c) => db.order.count({ where: { status: { in: ["ON_HOLD", "EXCEPTION"] }, originCountryCode: c } }),
      returns: (c) => db.vendorReturn.count({ where: { status: "INSTRUCTED", countryCode: c } }),
      storeReturns: (c) => db.storefrontReturn.count({ where: { status: { in: ["REQUESTED", "APPROVED"] }, order: { countryCode: c } } }),
      storePayouts: (c) => db.storefrontOrder.count({ where: { payoutStatus: "FAILED", countryCode: c } }),
      shoppingToPrice: (c) => db.shoppingRequest.count({ where: { status: "REQUESTED", confirmedAt: { not: null }, countryCode: c } }),
      shoppingToBuy: (c) => db.shoppingRequest.count({ where: { status: "PAID", countryCode: c } }),
      shoppingAtWarehouse: (c) => db.shoppingRequest.count({ where: { countryCode: c, OR: [{ status: "ARRIVED" }, { status: "BUYING", lines: { none: { status: "QUOTED" } } }] } }),
    };
  }

  async view(principal: AuthPrincipal, requestedCountry?: string): Promise<DashboardView> {
    if (principal.vendorId || principal.partnerId) {
      throw Errors.notFound();
    }
    const scoped = warehouseCountryScope(principal);
    const country = scoped ?? requestedCountry;
    const permitted = (Object.keys(this.counts) as AttentionKey[]).filter((key) => hasPermission(principal.role, STAFF_TOPICS[key].permission));
    const counts = await Promise.all(permitted.map((key) => this.counts[key](country)));
    const attention: AttentionItem[] = permitted
      .map((key, index) => ({ key, ...STAFF_TOPICS[key], count: counts[index]! }))
      .filter((item) => item.count > 0);
    const seesActivity = hasPermission(principal.role, "finance.read") || hasPermission(principal.role, "countries.read");
    return { countryCode: country ?? null, attention, activity: seesActivity ? await this.activity(country) : null };
  }

  private async activity(country: string | undefined): Promise<NonNullable<DashboardView["activity"]>> {
    const since = new Date(Date.now() - WINDOW_MS);
    const countryFilter = country ? Prisma.sql`AND v.country_code = ${country}` : Prisma.empty;
    const [newVendors, ordersCreated, ordersShipped, stockReceived, storeSales, fees, balances] = await Promise.all([
      this.prisma.vendor.count({ where: { createdAt: { gte: since }, countryCode: country } }),
      this.prisma.order.count({ where: { createdAt: { gte: since }, originCountryCode: country } }),
      this.prisma.order.count({ where: { handedOffAt: { gte: since }, originCountryCode: country } }),
      this.prisma.inboundShipment.count({ where: { receivedAt: { gte: since }, countryCode: country } }),
      this.prisma.storefrontOrder.groupBy({ by: ["currency"], where: { paidAt: { gte: since }, countryCode: country }, _sum: { totalMinor: true } }),
      this.prisma.$queryRaw<Array<{ currency: string; total: bigint }>>`
        SELECT w.currency, -SUM(l.amount_minor)::bigint AS total
        FROM ledger_entries l JOIN wallets w ON w.id = l.wallet_id JOIN vendors v ON v.id = l.vendor_id
        WHERE l.created_at >= ${since} AND l.type::text IN (${Prisma.join(CHARGES)}) ${countryFilter}
        GROUP BY w.currency ORDER BY w.currency`,
      this.prisma.$queryRaw<Array<{ currency: string; total: bigint }>>`
        SELECT w.currency, SUM(w.balance_minor)::bigint AS total FROM wallets w JOIN vendors v ON v.id = w.vendor_id WHERE true ${countryFilter} GROUP BY w.currency ORDER BY w.currency`,
    ]);
    const totals = (rows: Array<{ currency: string; total: bigint | null }>): MoneyTotal[] => rows.map((row) => ({ currency: row.currency, amountMinor: Number(row.total ?? 0) }));
    return {
      newVendors,
      ordersCreated,
      ordersShipped,
      stockReceived,
      storeSales: storeSales.map((row) => ({ currency: row.currency, amountMinor: Number(row._sum.totalMinor ?? 0) })),
      feesCharged: totals(fees),
      walletBalances: totals(balances),
    };
  }
}
