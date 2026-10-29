import { Injectable } from "@nestjs/common";

import { PrismaService } from "../../../database/prisma.service";
import type { OrderStatus, PartnerStockSummaryView } from "../../../shared";

const TO_SHIP: OrderStatus[] = ["PACKING_COMPLETED", "AWAITING_SHIPPING_SELECTION", "AWAITING_WALLET_FUNDING", "SHIPPING_PAID", "LABEL_PURCHASED"];

@Injectable()
export class PartnerStockSummaryService {
  constructor(private readonly prisma: PrismaService) {}

  async forPartner(partnerId: string): Promise<PartnerStockSummaryView> {
    const atHubs = { warehouse: { partnerId } };
    const inStock = { ...atHubs, OR: [{ quantityAvailable: { gt: 0 } }, { quantityReserved: { gt: 0 } }] };
    const [units, sellers, products, lotsWaitingToShelve, shipmentsExpected, ordersToPack, ordersToShip] = await Promise.all([
      this.prisma.stockLot.aggregate({ where: atHubs, _sum: { quantityAvailable: true, quantityReserved: true } }),
      this.prisma.stockLot.findMany({ where: inStock, distinct: ["vendorId"], select: { vendorId: true } }),
      this.prisma.stockLot.findMany({ where: inStock, distinct: ["productId"], select: { productId: true } }),
      this.prisma.stockLot.count({ where: { ...inStock, locationId: null } }),
      this.prisma.inboundShipment.count({ where: { ...atHubs, status: "SUBMITTED" } }),
      this.prisma.order.count({ where: { ...atHubs, status: "PENDING_PACKING" } }),
      this.prisma.order.count({ where: { ...atHubs, status: { in: TO_SHIP } } }),
    ]);
    const reserved = units._sum.quantityReserved ?? 0;
    return {
      unitsStored: (units._sum.quantityAvailable ?? 0) + reserved,
      unitsReserved: reserved,
      sellers: sellers.length,
      products: products.length,
      lotsWaitingToShelve,
      shipmentsExpected,
      ordersToPack,
      ordersToShip,
    };
  }
}
