import { Injectable } from "@nestjs/common";

import type { AuthPrincipal } from "../../../common/auth/auth-principal";
import { PrismaService } from "../../../database/prisma.service";
import { OPEN_ORDER_STATUSES, ORDER_STAGE_GUIDE } from "../../../shared";

function contactName(profile: unknown): string | null {
  const name = (profile as { fullName?: unknown } | null)?.fullName;
  return typeof name === "string" && name.trim() ? name.trim() : null;
}

@Injectable()
export class PartnerContextService {
  constructor(private readonly prisma: PrismaService) {}

  async describe(principal: AuthPrincipal & { partnerId: string }): Promise<string> {
    const partner = await this.prisma.fulfilmentPartner.findUniqueOrThrow({
      where: { id: principal.partnerId },
      select: { legalName: true, status: true, profile: true, country: { select: { name: true } }, warehouses: { where: { active: true }, select: { id: true, city: true } } },
    });
    const hubs = partner.warehouses.map((warehouse) => warehouse.id);
    const atHubs = { warehouseId: { in: hubs } };
    const [expected, atDock, orders, units] = await Promise.all([
      this.prisma.inboundShipment.count({ where: { ...atHubs, status: "SUBMITTED" } }),
      this.prisma.inboundShipment.count({ where: { ...atHubs, status: { in: ["ARRIVED", "ON_HOLD"] } } }),
      this.prisma.order.groupBy({ by: ["status"], where: { ...atHubs, status: { in: [...OPEN_ORDER_STATUSES] } }, _count: { _all: true } }),
      this.prisma.stockLot.aggregate({ where: atHubs, _sum: { quantityAvailable: true, quantityReserved: true } }),
    ]);
    const person = principal.role === "FULFILMENT_PARTNER" ? contactName(partner.profile) : null;
    const held = (units._sum.quantityAvailable ?? 0) + (units._sum.quantityReserved ?? 0);
    return [
      `Who you're helping: ${person ? `${person}, ` : ""}${principal.role === "FULFILMENT_PARTNER" ? "the lead" : "a team member"} at ${partner.legalName}, a fulfilment partner in ${partner.country.name}. Partnership status: ${partner.status}.${person ? ` Greet them by their first name.` : ""}`,
      partner.warehouses.length > 0 ? `Their hubs: ${partner.warehouses.map((warehouse) => warehouse.city).join(", ")}. Units stored: ${held}.` : "They have no open hub yet.",
      `Stock shipments on the way to them: ${expected}. At their dock waiting to be checked in: ${atDock}.`,
      orders.length > 0 ? `Open orders at their hubs:\n${orders.map((group) => `- ${ORDER_STAGE_GUIDE[group.status].label}: ${group._count._all}`).join("\n")}` : "No open orders at their hubs.",
    ].join("\n");
  }
}
