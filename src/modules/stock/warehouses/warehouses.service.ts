import { Injectable } from "@nestjs/common";

import type { AuthPrincipal, RequestMeta } from "../../../common/auth/auth-principal";
import { Errors } from "../../../common/http/app-exception";
import { lockRow, PrismaService } from "../../../database/prisma.service";
import type { Prisma } from "../../../generated/prisma/client";
import { AuditService } from "../../../infrastructure/audit/audit.service";
import type { LocationInput, LocationView, WarehouseInput, WarehouseView } from "../../../shared";
import { uniqueViolationModel, warehouseScope } from "../scope";
import { type WarehouseRow, WarehouseAccessService } from "./warehouse-access.service";

const HOLDS_STOCK: Prisma.StockLotWhereInput = { OR: [{ quantityAvailable: { gt: 0 } }, { quantityReserved: { gt: 0 } }] };

function toView(row: WarehouseRow): WarehouseView {
  return {
    id: row.id,
    countryCode: row.countryCode,
    code: row.code,
    name: row.name,
    addressLines: row.addressLines as string[],
    city: row.city,
    postalCode: row.postalCode,
    active: row.active,
    partnerId: row.partnerId,
  };
}

@Injectable()
export class WarehousesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: WarehouseAccessService,
    private readonly audit: AuditService,
  ) {}

  async list(principal: AuthPrincipal): Promise<WarehouseView[]> {
    const rows = await this.prisma.warehouse.findMany({ where: warehouseScope(principal), orderBy: [{ countryCode: "asc" }, { code: "asc" }] });
    return rows.map(toView);
  }

  async get(principal: AuthPrincipal, warehouseId: string): Promise<WarehouseView> {
    return toView(await this.access.inScope(principal, warehouseId));
  }

  async create(principal: AuthPrincipal, input: WarehouseInput, meta: RequestMeta): Promise<WarehouseView> {
    if (!(await this.prisma.country.findUnique({ where: { code: input.countryCode } }))) {
      throw Errors.validation({ countryCode: ["Choose a country on the platform"] });
    }
    try {
      return await this.prisma.$transaction(async (tx) => {
        const created = await tx.warehouse.create({ data: input });
        await this.audit.record(
          {
            actor: { userId: principal.userId, role: principal.role },
            action: "warehouse.created",
            resourceType: "warehouse",
            resourceId: created.id,
            countryCode: created.countryCode,
            after: { code: created.code, name: created.name },
            meta,
          },
          tx,
        );
        return toView(created);
      });
    } catch (error) {
      if (uniqueViolationModel(error) !== null) {
        throw Errors.validation({ code: ["This code is already used by another warehouse"] });
      }
      throw error;
    }
  }

  async setActive(principal: AuthPrincipal, warehouseId: string, active: boolean, meta: RequestMeta): Promise<WarehouseView> {
    const warehouse = await this.access.inScope(principal, warehouseId);
    const updated = await this.prisma.$transaction(async (tx) => {
      const row = await tx.warehouse.update({ where: { id: warehouse.id }, data: { active } });
      await this.audit.record(
        {
          actor: { userId: principal.userId, role: principal.role },
          action: active ? "warehouse.opened" : "warehouse.closed",
          resourceType: "warehouse",
          resourceId: warehouse.id,
          countryCode: warehouse.countryCode,
          meta,
        },
        tx,
      );
      return row;
    });
    return toView(updated);
  }

  async locations(principal: AuthPrincipal, warehouseId: string): Promise<LocationView[]> {
    const warehouse = await this.access.inScope(principal, warehouseId);
    const rows = await this.prisma.inventoryLocation.findMany({ where: { warehouseId: warehouse.id }, include: { _count: { select: { lots: { where: HOLDS_STOCK } } } }, orderBy: { code: "asc" } });
    return rows.map((location) => ({ id: location.id, warehouseId: location.warehouseId, code: location.code, label: location.label, active: location.active, lotCount: location._count.lots }));
  }

  async createLocation(principal: AuthPrincipal, warehouseId: string, input: LocationInput, meta: RequestMeta): Promise<void> {
    const warehouse = await this.access.inScope(principal, warehouseId);
    try {
      await this.prisma.$transaction(async (tx) => {
        const created = await tx.inventoryLocation.create({ data: { ...input, warehouseId: warehouse.id }, select: { id: true } });
        await this.audit.record(
          {
            actor: { userId: principal.userId, role: principal.role },
            action: "location.created",
            resourceType: "inventory_location",
            resourceId: created.id,
            countryCode: warehouse.countryCode,
            after: input,
            meta,
          },
          tx,
        );
      });
    } catch (error) {
      if (uniqueViolationModel(error) !== null) {
        throw Errors.validation({ code: ["This location code already exists in this warehouse"] });
      }
      throw error;
    }
  }

  async setLocationActive(principal: AuthPrincipal, warehouseId: string, locationId: string, active: boolean, meta: RequestMeta): Promise<void> {
    const warehouse = await this.access.inScope(principal, warehouseId);
    await this.prisma.$transaction(async (tx) => {
      await lockRow(tx, "inventoryLocations", locationId);
      const location = await tx.inventoryLocation.findFirst({ where: { id: locationId, warehouseId: warehouse.id } });
      if (!location) {
        throw Errors.notFound();
      }
      if (!active && (await tx.stockLot.count({ where: { locationId: location.id, ...HOLDS_STOCK } })) > 0) {
        throw Errors.invalidTransition("Move the stock out of this location before closing it.");
      }
      await tx.inventoryLocation.update({ where: { id: location.id }, data: { active } });
      await this.audit.record(
        {
          actor: { userId: principal.userId, role: principal.role },
          action: active ? "location.opened" : "location.closed",
          resourceType: "inventory_location",
          resourceId: location.id,
          countryCode: warehouse.countryCode,
          meta,
        },
        tx,
      );
    });
  }
}
