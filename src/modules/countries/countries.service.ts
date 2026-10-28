import { Injectable } from "@nestjs/common";
import { activationFeeOf, canTransitionCountry, type ChangeCountryStatusInput, type CreateCountryInput, type PublicCountry, type UpdateCountryInput } from "../../shared";

import type { AuthPrincipal, RequestMeta } from "../../common/auth/auth-principal";
import { Errors } from "../../common/http/app-exception";
import { PrismaService } from "../../database/prisma.service";
import { AuditService } from "../../infrastructure/audit/audit.service";
import { type CountryRecord, CountriesRepository } from "./countries.repository";

@Injectable()
export class CountriesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly countries: CountriesRepository,
    private readonly audit: AuditService,
  ) {}

  async listLive(): Promise<PublicCountry[]> {
    const live = await this.countries.listByStatus("LIVE");
    return live.map(toPublic);
  }

  listAll(): Promise<CountryRecord[]> {
    return this.countries.listAll();
  }

  async get(code: string): Promise<CountryRecord> {
    const country = await this.countries.findByCode(code);
    if (!country) {
      throw Errors.notFound("Country not found.");
    }
    return country;
  }

  create(input: CreateCountryInput, actor: AuthPrincipal, meta: RequestMeta): Promise<CountryRecord> {
    return this.prisma.$transaction(async (tx) => {
      const created = await this.countries.insert({ ...input, status: "PROSPECTIVE" }, tx);
      if (!created) {
        throw Errors.countryExists();
      }
      await this.audit.record(
        { actor: { userId: actor.userId, role: actor.role }, action: "country.created", resourceType: "country", resourceId: created.code, countryCode: created.code, after: created, meta },
        tx,
      );
      return created;
    });
  }

  update(code: string, input: UpdateCountryInput, actor: AuthPrincipal, meta: RequestMeta): Promise<CountryRecord> {
    return this.prisma.$transaction(async (tx) => {
      const before = await this.requireForUpdate(code, tx);
      const testVendorId = input.config?.partners.mysteryVendorId;
      if (testVendorId && !(await tx.vendor.findFirst({ where: { id: testVendorId, countryCode: code, isTestAccount: true }, select: { id: true } }))) {
        throw Errors.validation({ "config.partners.mysteryVendorId": ["Use an internal test vendor account in this country"] });
      }
      const updated = await this.countries.update(code, { ...input, config: input.config && { ...input.config, activationFeeMinor: activationFeeOf(before.config) } }, tx);
      await this.audit.record(
        { actor: { userId: actor.userId, role: actor.role }, action: "country.updated", resourceType: "country", resourceId: code, countryCode: code, before, after: updated, meta },
        tx,
      );
      return updated;
    });
  }

  changeStatus(code: string, input: ChangeCountryStatusInput, actor: AuthPrincipal, meta: RequestMeta): Promise<CountryRecord> {
    return this.prisma.$transaction(async (tx) => {
      const before = await this.requireForUpdate(code, tx);
      if (!canTransitionCountry(before.status, input.status)) {
        throw Errors.invalidTransition(`A ${before.status.toLowerCase()} country cannot move to ${input.status.toLowerCase()}.`);
      }
      const updated = await this.countries.update(code, { status: input.status, statusReason: input.reason, statusChangedAt: new Date() }, tx);
      await this.audit.record(
        {
          actor: { userId: actor.userId, role: actor.role },
          action: "country.status_changed",
          resourceType: "country",
          resourceId: code,
          countryCode: code,
          before: { status: before.status },
          after: { status: updated.status, reason: input.reason },
          meta,
        },
        tx,
      );
      return updated;
    });
  }

  private async requireForUpdate(code: string, executor: Parameters<CountriesRepository["findByCode"]>[1]): Promise<CountryRecord> {
    const country = await this.countries.findByCode(code, executor);
    if (!country) {
      throw Errors.notFound("Country not found.");
    }
    return country;
  }
}

function toPublic(country: CountryRecord): PublicCountry {
  return { code: country.code, name: country.name, currency: country.currency, status: country.status, locale: country.config.locale, measurementSystem: country.config.measurementSystem };
}
