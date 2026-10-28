import { Injectable } from "@nestjs/common";

import { type DatabaseClient, PrismaService } from "../../database/prisma.service";
import type { CountryConfig, VendorCountryView } from "../../shared";

export interface OpenCountry {
  code: string;
  currency: string;
}

@Injectable()
export class VendorCountriesRepository {
  constructor(private readonly prisma: PrismaService) {}

  async list(vendorId: string, client: DatabaseClient = this.prisma): Promise<VendorCountryView[]> {
    const rows = await client.vendorCountry.findMany({
      where: { vendorId },
      include: { country: { select: { name: true, currency: true, config: true } }, vendor: { select: { countryCode: true } } },
      orderBy: [{ createdAt: "asc" }, { countryCode: "asc" }],
    });
    return rows
      .map((row) => ({
        code: row.countryCode,
        name: row.country.name,
        currency: row.country.currency,
        home: row.countryCode === row.vendor.countryCode,
        addedAt: row.createdAt.toISOString(),
        address: (row.country.config as unknown as CountryConfig).address,
      }))
      .sort((a, b) => Number(b.home) - Number(a.home));
  }

  async open(client: DatabaseClient, vendorId: string, countries: readonly OpenCountry[]): Promise<void> {
    await client.vendorCountry.createMany({ data: countries.map((country) => ({ vendorId, countryCode: country.code })), skipDuplicates: true });
    for (const currency of new Set(countries.map((country) => country.currency))) {
      await client.wallet.upsert({ where: { vendorId_currency: { vendorId, currency } }, create: { vendorId, currency }, update: {} });
    }
  }

  async replace(client: DatabaseClient, vendorId: string, countries: readonly OpenCountry[]): Promise<void> {
    await client.vendorCountry.deleteMany({ where: { vendorId, countryCode: { notIn: countries.map((country) => country.code) } } });
    await this.open(client, vendorId, countries);
  }
}
