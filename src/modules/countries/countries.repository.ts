import { Injectable } from "@nestjs/common";

import { type DatabaseClient, PrismaService } from "../../database/prisma.service";
import type { Country, CountryStatus, Prisma } from "../../generated/prisma/client";
import type { CountryConfig, DestinationView } from "../../shared";

export type CountryRecord = Omit<Country, "config"> & { config: CountryConfig };
export type CountryInsert = Omit<Prisma.CountryUncheckedCreateInput, "config"> & { config: CountryConfig };

function toRecord(country: Country): CountryRecord {
  return { ...country, config: country.config as unknown as CountryConfig };
}

@Injectable()
export class CountriesRepository {
  constructor(private readonly prisma: PrismaService) {}

  async findByCode(code: string, client: DatabaseClient = this.prisma): Promise<CountryRecord | undefined> {
    const country = await client.country.findUnique({ where: { code } });
    return country ? toRecord(country) : undefined;
  }

  async listAll(): Promise<CountryRecord[]> {
    return (await this.prisma.country.findMany({ orderBy: { name: "asc" } })).map(toRecord);
  }

  async listByStatus(status: CountryStatus): Promise<CountryRecord[]> {
    return (await this.prisma.country.findMany({ where: { status }, orderBy: { name: "asc" } })).map(toRecord);
  }

  async insert(values: CountryInsert, client: DatabaseClient): Promise<CountryRecord | undefined> {
    const created = await client.country.createManyAndReturn({ data: [{ ...values, config: values.config }], skipDuplicates: true });
    return created[0] ? toRecord(created[0]) : undefined;
  }

  async update(code: string, changes: Partial<Omit<CountryInsert, "code" | "currency">>, client: DatabaseClient): Promise<CountryRecord> {
    const { config, ...rest } = changes;
    const updated = await client.country.update({ where: { code }, data: { ...rest, ...(config ? { config: config } : {}) } });
    return toRecord(updated);
  }

  async domesticDestinations(countryCode: string): Promise<DestinationView[]> {
    const country = await this.findByCode(countryCode);
    return country ? [{ code: country.code, name: country.name, customsRequired: false, address: country.config.address }] : [];
  }
}
