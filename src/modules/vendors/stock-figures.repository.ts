import { Injectable } from "@nestjs/common";

import { PrismaService } from "../../database/prisma.service";
import type { StockFacts } from "../../shared";
import { ON_THE_WAY_LINE } from "./directory-filters";

const NONE: StockFacts = { unitsInStorage: 0, unitsOnTheWay: 0, everStored: false };

@Injectable()
export class StockFiguresRepository {
  constructor(private readonly prisma: PrismaService) {}

  async forProducts(productIds: readonly string[]): Promise<(productId: string) => StockFacts> {
    if (productIds.length === 0) {
      return () => NONE;
    }
    const ids = [...productIds];
    const [stored, incoming] = await Promise.all([
      this.prisma.stockLot.groupBy({ by: ["productId"], where: { productId: { in: ids } }, _sum: { quantityAvailable: true, quantityReserved: true }, _count: { _all: true } }),
      this.prisma.inboundLine.groupBy({ by: ["productId"], where: { productId: { in: ids }, ...ON_THE_WAY_LINE }, _sum: { declaredQuantity: true } }),
    ]);
    const facts = new Map<string, StockFacts>(ids.map((id) => [id, NONE]));
    for (const row of stored) {
      facts.set(row.productId, { ...facts.get(row.productId)!, unitsInStorage: (row._sum.quantityAvailable ?? 0) + (row._sum.quantityReserved ?? 0), everStored: row._count._all > 0 });
    }
    for (const row of incoming) {
      facts.set(row.productId, { ...facts.get(row.productId)!, unitsOnTheWay: row._sum.declaredQuantity ?? 0 });
    }
    return (productId) => facts.get(productId) ?? NONE;
  }

  async unitsInStorageByVendor(vendorIds: readonly string[]): Promise<(vendorId: string) => number> {
    if (vendorIds.length === 0) {
      return () => 0;
    }
    const rows = await this.prisma.stockLot.groupBy({ by: ["vendorId"], where: { vendorId: { in: [...vendorIds] } }, _sum: { quantityAvailable: true, quantityReserved: true } });
    const units = new Map(rows.map((row) => [row.vendorId, (row._sum.quantityAvailable ?? 0) + (row._sum.quantityReserved ?? 0)]));
    return (vendorId) => units.get(vendorId) ?? 0;
  }
}
