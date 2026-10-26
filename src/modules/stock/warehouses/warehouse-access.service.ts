import { Injectable } from "@nestjs/common";

import type { AuthPrincipal } from "../../../common/auth/auth-principal";
import { Errors } from "../../../common/http/app-exception";
import { type DatabaseClient, PrismaService } from "../../../database/prisma.service";
import type { Warehouse } from "../../../generated/prisma/client";
import { warehouseScope } from "../scope";

export type WarehouseRow = Warehouse;

@Injectable()
export class WarehouseAccessService {
  constructor(private readonly prisma: PrismaService) {}

  async inScope(principal: AuthPrincipal, warehouseId: string, client: DatabaseClient = this.prisma): Promise<WarehouseRow> {
    const warehouse = await client.warehouse.findFirst({ where: { id: warehouseId, ...warehouseScope(principal) } });
    if (!warehouse) {
      throw Errors.notFound();
    }
    return warehouse;
  }

  async receivingWarehouseFor(countryCode: string, requestedId?: string): Promise<WarehouseRow> {
    const open = await this.prisma.warehouse.findMany({ where: { countryCode, active: true, OR: [{ partnerId: null }, { partner: { status: "ACTIVE" } }] } });
    const chosen = requestedId ? open.find((warehouse) => warehouse.id === requestedId) : open.length === 1 ? open[0] : undefined;
    if (!chosen) {
      throw Errors.validation({ warehouseId: [open.length === 0 ? "No warehouse is open in your market yet." : "Choose a warehouse."] });
    }
    return chosen;
  }
}
