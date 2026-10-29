import { Injectable } from "@nestjs/common";

import type { SellerCountry } from "../../../common/auth/selected-country";
import { PrismaService } from "../../../database/prisma.service";
import { hubArea, hubLabels, type ReceivingHubView } from "../../../shared";
import { WarehouseAccessService } from "../warehouses/warehouse-access.service";

@Injectable()
export class ReceivingHubsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly warehouses: WarehouseAccessService,
  ) {}

  async forVendor({ vendorId, countryCode }: SellerCountry): Promise<ReceivingHubView[]> {
    const open = await this.warehouses.openForReceiving(countryCode);
    const held = await this.prisma.stockLot.groupBy({
      by: ["warehouseId"],
      where: { vendorId, warehouseId: { in: open.map((warehouse) => warehouse.id) } },
      _sum: { quantityAvailable: true, quantityReserved: true },
    });
    const labels = hubLabels(open);
    return open.map((warehouse, index) => {
      const units = held.find((row) => row.warehouseId === warehouse.id)?._sum;
      return {
        warehouseId: warehouse.id,
        label: labels[index]!,
        city: warehouse.city,
        area: hubArea(warehouse.postalCode),
        unitsHeld: (units?.quantityAvailable ?? 0) + (units?.quantityReserved ?? 0),
      };
    });
  }
}
