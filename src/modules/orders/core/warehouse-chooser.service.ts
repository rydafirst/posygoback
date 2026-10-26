import { Injectable } from "@nestjs/common";

import { PrismaService } from "../../../database/prisma.service";
import type { Warehouse } from "../../../generated/prisma/client";

export interface WarehouseChoice {
  candidates: number;
  warehouse: Warehouse | null;
  shortProductIds: string[];
}

@Injectable()
export class WarehouseChooserService {
  constructor(private readonly prisma: PrismaService) {}

  async choose(vendorId: string, countryCode: string, needed: ReadonlyMap<string, number>, requestedId?: string): Promise<WarehouseChoice> {
    const candidates = await this.prisma.warehouse.findMany({
      where: { countryCode, active: true, OR: [{ partnerId: null }, { partner: { status: "ACTIVE" } }], ...(requestedId ? { id: requestedId } : {}) },
      orderBy: { code: "asc" },
    });
    if (candidates.length === 0) {
      return { candidates: 0, warehouse: null, shortProductIds: [...needed.keys()] };
    }
    const stock = await this.prisma.stockLot.groupBy({
      by: ["warehouseId", "productId"],
      where: { vendorId, warehouseId: { in: candidates.map((warehouse) => warehouse.id) }, productId: { in: [...needed.keys()] }, condition: "SELLABLE" },
      _sum: { quantityAvailable: true },
    });
    const available = (warehouseId: string, productId: string) => stock.find((row) => row.warehouseId === warehouseId && row.productId === productId)?._sum.quantityAvailable ?? 0;
    const chosen = candidates.find((warehouse) => [...needed].every(([productId, quantity]) => available(warehouse.id, productId) >= quantity)) ?? null;
    const best = candidates[0]!;
    return {
      candidates: candidates.length,
      warehouse: chosen,
      shortProductIds: chosen ? [] : [...needed].filter(([productId, quantity]) => available(best.id, productId) < quantity).map(([productId]) => productId),
    };
  }
}
