import { Injectable } from "@nestjs/common";

import type { AuthPrincipal } from "../../common/auth/auth-principal";
import { Errors } from "../../common/http/app-exception";
import { PrismaService } from "../../database/prisma.service";
import { LegalDocumentsRepository } from "./agreements/legal-documents.repository";
import { vendorIdOf } from "./scope";

export interface TradingVendor {
  vendorId: string;
  countryCode: string;
  businessName: string;
}

@Injectable()
export class VendorStandingService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly legal: LegalDocumentsRepository,
  ) {}

  assertCanTrade(principal: AuthPrincipal): Promise<TradingVendor> {
    return this.assertVendorCanTrade(vendorIdOf(principal));
  }

  async assertVendorCanTrade(vendorId: string): Promise<TradingVendor> {
    const vendor = await this.prisma.vendor.findUnique({ where: { id: vendorId } });
    if (!vendor || vendor.status !== "ACTIVE") {
      throw Errors.forbidden("Finish verifying your business before sending stock.");
    }
    const agreement = await this.legal.latest(vendor.countryCode, "VENDOR_AGREEMENT");
    const accepted = agreement ? await this.legal.acceptances(vendorId, [agreement.id]) : new Map();
    if (!agreement || !accepted.has(agreement.id)) {
      throw Errors.forbidden("Accept the latest vendor agreement to continue.");
    }
    return { vendorId, countryCode: vendor.countryCode, businessName: vendor.businessName };
  }
}
