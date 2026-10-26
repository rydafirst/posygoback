import { Injectable } from "@nestjs/common";

import type { AuthPrincipal } from "../../../common/auth/auth-principal";
import { PrismaService } from "../../../database/prisma.service";
import { type HubSignalView, partnerProgramme, tierFor } from "../../../shared";
import { vendorIdOf } from "../../onboarding/scope";

@Injectable()
export class HubSignalsService {
  constructor(private readonly prisma: PrismaService) {}

  async forVendor(principal: AuthPrincipal): Promise<HubSignalView[]> {
    const vendorId = vendorIdOf(principal);
    const vendor = await this.prisma.vendor.findUniqueOrThrow({ where: { id: vendorId }, select: { countryCode: true } });
    const today = new Date();
    const warehouses = await this.prisma.warehouse.findMany({
      where: {
        OR: [
          { lots: { some: { vendorId, OR: [{ quantityAvailable: { gt: 0 } }, { quantityReserved: { gt: 0 } }] } } },
          { countryCode: vendor.countryCode, active: true, OR: [{ partnerId: null }, { partner: { status: "ACTIVE" } }] },
        ],
      },
      select: {
        id: true,
        name: true,
        country: { select: { currency: true, config: true } },
        partner: {
          select: {
            tierLevel: true,
            insurance: { where: { status: "VERIFIED", startsOn: { lte: today }, expiresOn: { gt: today } }, select: { coverMinor: true } },
            stockCounts: { where: { status: "MATCHED" }, orderBy: { submittedAt: "desc" }, take: 1, select: { submittedAt: true } },
          },
        },
      },
      orderBy: { name: "asc" },
    });
    const units = await this.prisma.stockLot.groupBy({ by: ["warehouseId"], where: { vendorId }, _sum: { quantityAvailable: true, quantityReserved: true } });
    return warehouses.map((warehouse) => {
      const held = units.find((row) => row.warehouseId === warehouse.id);
      const partner = warehouse.partner;
      return {
        warehouseId: warehouse.id,
        warehouseName: warehouse.name,
        operator: partner ? "PARTNER" : "PLATFORM",
        tierName: partner ? tierFor(partnerProgramme(warehouse.country.config as { partners?: unknown }), partner.tierLevel).name : null,
        insuredCoverMinor: partner ? partner.insurance.reduce((total, policy) => total + Number(policy.coverMinor), 0) : 0,
        currency: warehouse.country.currency,
        units: (held?._sum.quantityAvailable ?? 0) + (held?._sum.quantityReserved ?? 0),
        lastCountedAt: partner?.stockCounts[0]?.submittedAt?.toISOString() ?? null,
      };
    });
  }
}
