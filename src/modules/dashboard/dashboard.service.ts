import { Injectable } from "@nestjs/common";

import type { AuthPrincipal } from "../../common/auth/auth-principal";
import { Errors } from "../../common/http/app-exception";
import { PrismaService } from "../../database/prisma.service";
import { Prisma } from "../../generated/prisma/client";
import { type AttentionItem, type DashboardView, hasPermission, type MoneyTotal, type Permission } from "../../shared";
import { warehouseCountryScope } from "../stock/scope";

const WINDOW_MS = 30 * 24 * 60 * 60 * 1000;
const CHARGES = ["ONBOARDING", "STORAGE", "FULFILMENT", "SHIPPING", "RETURN", "RECEIVING_HOLD_FEE", "STOREFRONT_FEE"];

interface Check {
  key: string;
  label: string;
  href: string;
  permission: Permission;
  count: (country: string | undefined) => Promise<number>;
}

@Injectable()
export class DashboardService {
  private readonly checks: Check[];

  constructor(private readonly prisma: PrismaService) {
    const db = this.prisma;
    this.checks = [
      {
        key: "verifications",
        label: "Vendor checks to review",
        href: "/admin/verifications",
        permission: "verifications.review",
        count: (c) => db.vendorVerification.count({ where: { status: "SUBMITTED", countryCode: c } }),
      },
      {
        key: "partners",
        label: "Partner applications to review",
        href: "/admin/partners",
        permission: "partners.review",
        count: (c) => db.fulfilmentPartner.count({ where: { status: "UNDER_REVIEW", countryCode: c } }),
      },
      {
        key: "prices",
        label: "Price lists waiting for approval",
        href: "/admin/fees",
        permission: "fees.approve",
        count: (c) => db.feeSchedule.count({ where: { status: "PROPOSED", countryCode: c } }),
      },
      {
        key: "adjustments",
        label: "Wallet adjustments to approve",
        href: "/admin/finance",
        permission: "finance.approve",
        count: (c) => db.walletAdjustment.count({ where: { status: "PENDING_APPROVAL", wallet: { vendor: { countryCode: c } } } }),
      },
      {
        key: "partnerPayouts",
        label: "Partner payouts to approve",
        href: "/admin/partners",
        permission: "partners.finance",
        count: (c) => db.partnerPayout.count({ where: { status: "PENDING_APPROVAL", partner: { countryCode: c } } }),
      },
      { key: "claimsToAssess", label: "Claims to assess", href: "/admin/claims", permission: "claims.assess", count: (c) => db.custodyClaim.count({ where: { status: "OPEN", countryCode: c } }) },
      { key: "claimsToDecide", label: "Claims to decide", href: "/admin/claims", permission: "claims.decide", count: (c) => db.custodyClaim.count({ where: { status: "ASSESSED", countryCode: c } }) },
      { key: "alerts", label: "Open custody alerts", href: "/admin/custody-alerts", permission: "claims.read", count: (c) => db.custodyAlert.count({ where: { status: "OPEN", countryCode: c } }) },
      {
        key: "inbound",
        label: "Stock shipments waiting at the door",
        href: "/admin/receiving",
        permission: "inbound.receive",
        count: (c) => db.inboundShipment.count({ where: { status: { in: ["ARRIVED", "ON_HOLD"] }, countryCode: c } }),
      },
      {
        key: "ordersStuck",
        label: "Orders on hold or with a carrier problem",
        href: "/admin/orders",
        permission: "orders.read",
        count: (c) => db.order.count({ where: { status: { in: ["ON_HOLD", "EXCEPTION"] }, originCountryCode: c } }),
      },
      {
        key: "returns",
        label: "Returns ready to finish",
        href: "/admin/returns",
        permission: "inbound.receive",
        count: (c) => db.vendorReturn.count({ where: { status: "INSTRUCTED", countryCode: c } }),
      },
      {
        key: "storeReturns",
        label: "Store returns still open",
        href: "/admin/storefront-returns",
        permission: "storefronts.read",
        count: (c) => db.storefrontReturn.count({ where: { status: { in: ["REQUESTED", "APPROVED"] }, order: { countryCode: c } } }),
      },
      {
        key: "storePayouts",
        label: "Store payouts that failed",
        href: "/admin/storefront-orders",
        permission: "storefronts.manage",
        count: (c) => db.storefrontOrder.count({ where: { payoutStatus: "FAILED", countryCode: c } }),
      },
      {
        key: "shoppingToPrice",
        label: "Shopping requests to price",
        href: "/admin/shopping",
        permission: "shopping.manage",
        count: (c) => db.shoppingRequest.count({ where: { status: "REQUESTED", confirmedAt: { not: null }, countryCode: c } }),
      },
      {
        key: "shoppingToBuy",
        label: "Paid shopping requests to buy",
        href: "/admin/shopping",
        permission: "shopping.manage",
        count: (c) => db.shoppingRequest.count({ where: { status: "PAID", countryCode: c } }),
      },
      {
        key: "shoppingAtWarehouse",
        label: "Shopping parcels to book in or send",
        href: "/admin/shopping-desk",
        permission: "orders.fulfil",
        count: (c) => db.shoppingRequest.count({ where: { countryCode: c, OR: [{ status: "ARRIVED" }, { status: "BUYING", lines: { none: { status: "QUOTED" } } }] } }),
      },
    ];
  }

  async view(principal: AuthPrincipal, requestedCountry?: string): Promise<DashboardView> {
    if (principal.vendorId || principal.partnerId) {
      throw Errors.notFound();
    }
    const scoped = warehouseCountryScope(principal);
    const country = scoped ?? requestedCountry;
    const permitted = this.checks.filter((check) => hasPermission(principal.role, check.permission));
    const counts = await Promise.all(permitted.map((check) => check.count(country)));
    const attention: AttentionItem[] = permitted
      .map((check, index) => ({ key: check.key, label: check.label, href: check.href, permission: check.permission, count: counts[index]! }))
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
