import { Injectable } from "@nestjs/common";

import type { AuthPrincipal, RequestMeta } from "../../../common/auth/auth-principal";
import { startOfUtcDay } from "../../../common/dates";
import { Errors } from "../../../common/http/app-exception";
import { PrismaService } from "../../../database/prisma.service";
import { AuditService } from "../../../infrastructure/audit/audit.service";
import { acceptsNewVendors, hasPermission, MAX_VENDOR_COUNTRIES, type VendorCountryFiguresView, type VendorCountryView } from "../../../shared";
import { CountriesRepository } from "../../countries/countries.repository";
import { VendorCountriesRepository } from "../../countries/vendor-countries.repository";
import { vendorIdOf } from "../scope";

@Injectable()
export class VendorCountriesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly countries: CountriesRepository,
    private readonly vendorCountries: VendorCountriesRepository,
    private readonly audit: AuditService,
  ) {}

  list(principal: AuthPrincipal): Promise<VendorCountryView[]> {
    return this.vendorCountries.list(vendorIdOf(principal));
  }

  async add(principal: AuthPrincipal, countryCode: string, meta: RequestMeta): Promise<VendorCountryView[]> {
    const vendorId = vendorIdOf(principal);
    const country = await this.countries.findByCode(countryCode);
    if (!country || !acceptsNewVendors(country.status)) {
      throw Errors.countryUnavailable();
    }
    const current = await this.vendorCountries.list(vendorId);
    if (current.some((entry) => entry.code === countryCode)) {
      throw Errors.validation({ countryCode: ["You already store stock here"] });
    }
    if (current.length >= MAX_VENDOR_COUNTRIES) {
      throw Errors.validation({ countryCode: [`You can store stock in up to ${MAX_VENDOR_COUNTRIES} countries`] });
    }
    await this.prisma.$transaction(async (tx) => {
      await this.vendorCountries.open(tx, vendorId, [{ code: country.code, currency: country.currency }]);
      await this.audit.record(
        {
          actor: { userId: principal.userId, role: principal.role },
          action: "vendor.country_added",
          resourceType: "vendor",
          resourceId: vendorId,
          vendorId,
          countryCode,
          after: { countryCode },
          meta,
        },
        tx,
      );
    });
    return this.vendorCountries.list(vendorId);
  }

  async figures(principal: AuthPrincipal): Promise<VendorCountryFiguresView[]> {
    const vendorId = vendorIdOf(principal);
    const countries = await this.vendorCountries.list(vendorId);
    const [balances, units, orders] = await Promise.all([
      hasPermission(principal.role, "vendor.wallet.read") ? this.balances(vendorId) : null,
      hasPermission(principal.role, "vendor.stock.read") ? this.unitsInStorage(vendorId) : null,
      hasPermission(principal.role, "vendor.orders.read") ? this.ordersToday(vendorId) : null,
    ]);
    return countries.map((country) => ({
      code: country.code,
      currency: country.currency,
      balanceMinor: balances ? (balances.get(country.currency) ?? 0) : null,
      unitsInStorage: units ? (units.get(country.code) ?? 0) : null,
      ordersToday: orders ? (orders.get(country.code) ?? 0) : null,
    }));
  }

  private async balances(vendorId: string): Promise<Map<string, number>> {
    const wallets = await this.prisma.wallet.findMany({ where: { vendorId }, select: { currency: true, balanceMinor: true } });
    return new Map(wallets.map((wallet) => [wallet.currency, Number(wallet.balanceMinor)]));
  }

  private async unitsInStorage(vendorId: string): Promise<Map<string, number>> {
    const lots = await this.prisma.stockLot.findMany({
      where: { vendorId, condition: "SELLABLE", quantityAvailable: { gt: 0 } },
      select: { quantityAvailable: true, warehouse: { select: { countryCode: true } } },
    });
    const totals = new Map<string, number>();
    for (const lot of lots) {
      totals.set(lot.warehouse.countryCode, (totals.get(lot.warehouse.countryCode) ?? 0) + lot.quantityAvailable);
    }
    return totals;
  }

  private async ordersToday(vendorId: string): Promise<Map<string, number>> {
    const rows = await this.prisma.order.groupBy({ by: ["originCountryCode"], where: { vendorId, createdAt: { gte: startOfUtcDay(new Date()) } }, _count: { _all: true } });
    return new Map(rows.map((row) => [row.originCountryCode, row._count._all]));
  }
}
