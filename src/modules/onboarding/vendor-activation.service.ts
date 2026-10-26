import { Injectable } from "@nestjs/common";

import { lockRow } from "../../database/prisma.service";
import type { Prisma } from "../../generated/prisma/client";
import { AuditService, SYSTEM_ACTOR } from "../../infrastructure/audit/audit.service";
import { LegalDocumentsRepository } from "./agreements/legal-documents.repository";
import { VerificationStore } from "./verification/verification.store";

@Injectable()
export class VendorActivationService {
  constructor(
    private readonly verifications: VerificationStore,
    private readonly legal: LegalDocumentsRepository,
    private readonly audit: AuditService,
  ) {}

  async refresh(vendorId: string, countryCode: string, executor: Prisma.TransactionClient): Promise<boolean> {
    await lockRow(executor, "vendors", vendorId);
    const verification = await this.verifications.find(vendorId, executor);
    if (verification?.status !== "APPROVED") {
      return false;
    }
    const agreement = await this.legal.latest(countryCode, "VENDOR_AGREEMENT", executor);
    if (!agreement) {
      return false;
    }
    const accepted = await this.legal.acceptances(vendorId, [agreement.id], executor);
    if (!accepted.has(agreement.id)) {
      return false;
    }
    const activated = await executor.vendor.updateMany({ where: { id: vendorId, status: "PENDING_VERIFICATION" }, data: { status: "ACTIVE" } });
    if (activated.count > 0) {
      await this.audit.record({ actor: SYSTEM_ACTOR, action: "vendor.activated", resourceType: "vendor", resourceId: vendorId, vendorId, countryCode }, executor);
    }
    return activated.count > 0;
  }
}
