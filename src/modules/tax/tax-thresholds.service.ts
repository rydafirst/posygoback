import { Injectable } from "@nestjs/common";

import { PrismaService } from "../../database/prisma.service";
import { Prisma } from "../../generated/prisma/client";
import { FEE_TYPES, TAX_THRESHOLDS, type TaxThresholdView } from "../../shared";

const YEAR_MS = 365 * 24 * 60 * 60 * 1000;

@Injectable()
export class TaxThresholdsService {
  constructor(private readonly prisma: PrismaService) {}

  async all(): Promise<TaxThresholdView[]> {
    const views = await Promise.all(Object.keys(TAX_THRESHOLDS).map((code) => this.forCountry(code)));
    return views.filter((view): view is TaxThresholdView => view !== null);
  }

  async forCountry(countryCode: string): Promise<TaxThresholdView | null> {
    const threshold = TAX_THRESHOLDS[countryCode];
    const country = threshold ? await this.prisma.country.findUnique({ where: { code: countryCode }, select: { currency: true } }) : null;
    if (!threshold || !country) {
      return null;
    }
    const since = new Date(Date.now() - YEAR_MS);
    const [row] = await this.prisma.$queryRaw<Array<{ total: bigint | null }>>`
      SELECT -SUM(l.amount_minor)::bigint AS total
      FROM ledger_entries l JOIN wallets w ON w.id = l.wallet_id JOIN vendors v ON v.id = l.vendor_id
      WHERE l.created_at >= ${since} AND l.type::text IN (${Prisma.join(FEE_TYPES)})
        AND v.country_code = ${countryCode} AND w.currency = ${country.currency}`;
    return { countryCode, currency: country.currency, last12MonthsMinor: Number(row?.total ?? 0), ...threshold };
  }
}
