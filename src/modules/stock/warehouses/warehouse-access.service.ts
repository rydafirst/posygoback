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

  openForReceiving(countryCode: string): Promise<WarehouseRow[]> {
    return this.prisma.warehouse.findMany({ where: { countryCode, active: true, OR: [{ partnerId: null }, { partner: { status: "ACTIVE" } }] }, orderBy: [{ city: "asc" }, { postalCode: "asc" }, { code: "asc" }] });
  }

  async receivingWarehouseFor(countryCode: string, requestedId?: string): Promise<WarehouseRow> {
    const open = await this.openForReceiving(countryCode);
    const chosen = requestedId ? open.find((warehouse) => warehouse.id === requestedId) : open.length === 1 ? open[0] : undefined;
    if (!chosen) {
      throw Errors.validation({ warehouseId: [open.length === 0 ? "No hub is open in this country yet." : "Choose the hub to send your stock to."] });
    }
    return chosen;
  }
}
