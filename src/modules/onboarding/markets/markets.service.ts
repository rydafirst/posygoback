import { Injectable } from "@nestjs/common";

import type { AuthPrincipal, RequestMeta } from "../../../common/auth/auth-principal";
import { Errors } from "../../../common/http/app-exception";
import { PrismaService } from "../../../database/prisma.service";
import { AuditService } from "../../../infrastructure/audit/audit.service";
import type { DestinationPreferenceView } from "../../../shared";
import { CountriesRepository } from "../../countries/countries.repository";
import { vendorIdOf } from "../scope";

@Injectable()
export class MarketsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly countries: CountriesRepository,
    private readonly audit: AuditService,
  ) {}

  async preferences(principal: AuthPrincipal): Promise<DestinationPreferenceView[]> {
    const vendorId = vendorIdOf(principal);
    const lanes = await this.countries.enabledDestinations(principal.countryCode ?? "");
    const preferred = await this.preferredCodes(vendorId);
    return lanes.map((lane) => ({ ...lane, preferred: preferred.has(lane.code) }));
  }

  async setPreferences(principal: AuthPrincipal, countryCodes: readonly string[], meta: RequestMeta): Promise<DestinationPreferenceView[]> {
    const vendorId = vendorIdOf(principal);
    const allowed = new Set((await this.countries.enabledDestinations(principal.countryCode ?? "")).map((lane) => lane.code));
    const requested = [...new Set(countryCodes)];
    const invalid = requested.filter((code) => !allowed.has(code));
    if (invalid.length > 0) {
      throw Errors.validation({ countryCodes: [`Not open from your market: ${invalid.join(", ")}`] });
    }
    const before = [...(await this.preferredCodes(vendorId))];
    await this.prisma.$transaction(async (tx) => {
      await tx.vendorDestination.deleteMany({ where: { vendorId } });
      await tx.vendorDestination.createMany({ data: requested.map((countryCode) => ({ vendorId, countryCode })) });
      await this.audit.record(
        { actor: { userId: principal.userId, role: principal.role }, action: "vendor.destinations_set", resourceType: "vendor", resourceId: vendorId, vendorId, before, after: requested, meta },
        tx,
      );
    });
    return this.preferences(principal);
  }

  private async preferredCodes(vendorId: string): Promise<Set<string>> {
    const rows = await this.prisma.vendorDestination.findMany({ where: { vendorId }, select: { countryCode: true } });
    return new Set(rows.map((row) => row.countryCode));
  }
}
