import { Injectable } from "@nestjs/common";

import { lockRow } from "../../database/prisma.service";
import type { Prisma } from "../../generated/prisma/client";
import { AuditService, SYSTEM_ACTOR } from "../../infrastructure/audit/audit.service";
import { activationFeeOf } from "../../shared";
import { CountriesRepository } from "../countries/countries.repository";
import { LegalDocumentsRepository } from "./agreements/legal-documents.repository";
import { VerificationStore } from "./verification/verification.store";

export interface ActivationResult {
  vendorActive: boolean;
  activationDue: boolean;
}

const NOT_YET: ActivationResult = { vendorActive: false, activationDue: false };

@Injectable()
export class VendorActivationService {
  constructor(
    private readonly verifications: VerificationStore,
    private readonly legal: LegalDocumentsRepository,
    private readonly countries: CountriesRepository,
    private readonly audit: AuditService,
  ) {}

  async refresh(vendorId: string, countryCode: string, executor: Prisma.TransactionClient): Promise<ActivationResult> {
    await lockRow(executor, "vendors", vendorId);
    if (!(await this.readyForActivation(vendorId, countryCode, executor))) {
      return NOT_YET;
    }
    const country = await this.countries.findByCode(countryCode, executor);
    const feeMinor = country ? activationFeeOf(country.config) : 0;
    if (feeMinor === 0) {
      return { vendorActive: await this.goLive(vendorId, countryCode, executor, { feeMinor }), activationDue: false };
    }
    const due = await executor.vendor.updateMany({ where: { id: vendorId, status: "PENDING_VERIFICATION", activationDueAt: null }, data: { activationDueAt: new Date() } });
    if (due.count > 0) {
      await this.audit.record({ actor: SYSTEM_ACTOR, action: "vendor.activation_due", resourceType: "vendor", resourceId: vendorId, vendorId, countryCode, after: { feeMinor } }, executor);
    }
    return { vendorActive: false, activationDue: due.count > 0 };
  }

  async goLive(vendorId: string, countryCode: string, executor: Prisma.TransactionClient, details: Record<string, unknown>): Promise<boolean> {
    const activated = await executor.vendor.updateMany({ where: { id: vendorId, status: "PENDING_VERIFICATION" }, data: { status: "ACTIVE" } });
    if (activated.count > 0) {
      await this.audit.record({ actor: SYSTEM_ACTOR, action: "vendor.activated", resourceType: "vendor", resourceId: vendorId, vendorId, countryCode, after: details }, executor);
    }
    return activated.count > 0;
  }

  private async readyForActivation(vendorId: string, countryCode: string, executor: Prisma.TransactionClient): Promise<boolean> {
    const verification = await this.verifications.find(vendorId, executor);
    if (verification?.status !== "APPROVED") {
      return false;
    }
    const agreement = await this.legal.latest(countryCode, "VENDOR_AGREEMENT", executor);
    if (!agreement) {
      return false;
    }
    const accepted = await this.legal.acceptances(vendorId, [agreement.id], executor);
    return accepted.has(agreement.id);
  }
}
