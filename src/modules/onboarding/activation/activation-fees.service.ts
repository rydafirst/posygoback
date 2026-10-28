import { Injectable } from "@nestjs/common";

import type { AuthPrincipal, RequestMeta } from "../../../common/auth/auth-principal";
import { Errors } from "../../../common/http/app-exception";
import { PrismaService } from "../../../database/prisma.service";
import type { Prisma } from "../../../generated/prisma/client";
import { AuditService } from "../../../infrastructure/audit/audit.service";
import { type ActivationFeeInput, activationFeeOf, hasPermission } from "../../../shared";
import { CountriesRepository, type CountryRecord } from "../../countries/countries.repository";
import { VendorActivationService } from "../vendor-activation.service";
import { ActivationNoticesService } from "./activation-notices.service";

@Injectable()
export class ActivationFeesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly countries: CountriesRepository,
    private readonly activation: VendorActivationService,
    private readonly notices: ActivationNoticesService,
    private readonly audit: AuditService,
  ) {}

  async set(code: string, input: ActivationFeeInput, principal: AuthPrincipal, meta: RequestMeta): Promise<CountryRecord> {
    if (!hasPermission(principal.role, "countries.manage")) {
      throw Errors.forbidden("Only a super admin can change the activation fee.");
    }
    const { country, liveNow } = await this.prisma.$transaction(async (tx) => {
      const before = await this.countries.findByCode(code, tx);
      if (!before) {
        throw Errors.notFound("Country not found.");
      }
      const previous = activationFeeOf(before.config);
      const updated = await this.countries.update(code, { config: { ...before.config, activationFeeMinor: input.activationFeeMinor } }, tx);
      if (previous !== input.activationFeeMinor) {
        await this.audit.record(
          {
            actor: { userId: principal.userId, role: principal.role },
            action: "country.activation_fee_changed",
            resourceType: "country",
            resourceId: code,
            countryCode: code,
            before: { activationFeeMinor: previous, currency: before.currency },
            after: { activationFeeMinor: input.activationFeeMinor, currency: before.currency },
            meta,
          },
          tx,
        );
      }
      return { country: updated, liveNow: input.activationFeeMinor === 0 ? await this.releaseWaiting(code, tx) : [] };
    });
    for (const vendorId of liveNow) {
      await this.notices.waived(vendorId);
    }
    return country;
  }

  private async releaseWaiting(countryCode: string, tx: Prisma.TransactionClient): Promise<string[]> {
    const waiting = await tx.vendor.findMany({ where: { countryCode, status: "PENDING_VERIFICATION", activationDueAt: { not: null } }, select: { id: true } });
    const released: string[] = [];
    for (const { id } of waiting) {
      if (await this.activation.goLive(id, countryCode, tx, { feeMinor: 0, reason: "activation fee removed" })) {
        released.push(id);
      }
    }
    return released;
  }
}
