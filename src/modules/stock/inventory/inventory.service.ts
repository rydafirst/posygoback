import { Injectable } from "@nestjs/common";

import type { AuthPrincipal, RequestMeta } from "../../../common/auth/auth-principal";
import type { SellerCountry } from "../../../common/auth/selected-country";
import { Errors } from "../../../common/http/app-exception";
import { lockRow, PrismaService } from "../../../database/prisma.service";
import type { Prisma } from "../../../generated/prisma/client";
import { AuditService } from "../../../infrastructure/audit/audit.service";
import type { CustodyEventView, LabelView, LotView, MovementView } from "../../../shared";
import { vendorIdOf } from "../../onboarding/scope";
import { WarehouseAccessService } from "../warehouses/warehouse-access.service";
import { InventoryLedgerService } from "./inventory-ledger.service";

export interface LotFilters {
  vendorId?: string;
  countryCode?: string;
  warehouseId?: string;
  productId?: string;
  unplacedOnly?: boolean;
  inboundId?: string;
  lotIds?: string[];
}

const LOT_INCLUDE = {
  product: { select: { code: true, name: true, variantLabel: true } },
  vendor: { select: { businessName: true } },
  location: { select: { code: true } },
  inbound: { select: { reference: true } },
} satisfies Prisma.StockLotInclude;

type LotRow = Prisma.StockLotGetPayload<{ include: typeof LOT_INCLUDE }>;

@Injectable()
export class InventoryService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly warehouses: WarehouseAccessService,
    private readonly ledger: InventoryLedgerService,
    private readonly audit: AuditService,
  ) {}

  vendorLots(country: SellerCountry, productId?: string): Promise<LotView[]> {
    return this.lots({ vendorId: country.vendorId, countryCode: country.countryCode, productId });
  }

  async warehouseLots(principal: AuthPrincipal, warehouseId: string, unplacedOnly: boolean): Promise<LotView[]> {
    const warehouse = await this.warehouses.inScope(principal, warehouseId);
    const lots = await this.lots({ warehouseId: warehouse.id, unplacedOnly });
    const hidden = await this.underBlindCount(principal, warehouse.id);
    return lots.filter((lot) => !hidden.has(lot.id));
  }

  private async underBlindCount(principal: AuthPrincipal, warehouseId: string): Promise<Set<string>> {
    if (!principal.partnerId) {
      return new Set();
    }
    const lines = await this.prisma.stockCountLine.findMany({ where: { count: { warehouseId, status: "REQUESTED" } }, select: { lotId: true } });
    return new Set(lines.map((line) => line.lotId));
  }

  async vendorMovements(country: SellerCountry): Promise<MovementView[]> {
    const rows = await this.prisma.inventoryMovement.findMany({
      where: { vendorId: country.vendorId, warehouse: { countryCode: country.countryCode } },
      include: { lot: { select: { code: true, product: { select: { code: true } } } } },
      orderBy: { createdAt: "desc" },
      take: 200,
    });
    return rows.map((movement) => ({
      id: movement.id,
      type: movement.type,
      lotCode: movement.lot.code,
      productCode: movement.lot.product.code,
      deltaAvailable: movement.deltaAvailable,
      deltaReserved: movement.deltaReserved,
      reason: movement.reason,
      createdAt: movement.createdAt.toISOString(),
    }));
  }

  async vendorCustody(principal: AuthPrincipal, lotId: string): Promise<CustodyEventView[]> {
    const lot = await this.prisma.stockLot.findFirst({ where: { id: lotId, vendorId: vendorIdOf(principal) } });
    if (!lot) {
      throw Errors.notFound();
    }
    return this.custody(lot.id, false);
  }

  async warehouseCustody(principal: AuthPrincipal, lotId: string): Promise<CustodyEventView[]> {
    const lot = await this.prisma.stockLot.findUnique({ where: { id: lotId } });
    if (!lot) {
      throw Errors.notFound();
    }
    await this.warehouses.inScope(principal, lot.warehouseId);
    if ((await this.underBlindCount(principal, lot.warehouseId)).has(lot.id)) {
      throw Errors.notFound();
    }
    return this.custody(lot.id, true);
  }

  async place(principal: AuthPrincipal, lotId: string, locationId: string, meta: RequestMeta): Promise<LotView> {
    await this.prisma.$transaction(async (tx) => {
      const lot = (await lockRow(tx, "stockLots", lotId)) ? await tx.stockLot.findUnique({ where: { id: lotId } }) : null;
      if (!lot) {
        throw Errors.notFound();
      }
      const warehouse = await this.warehouses.inScope(principal, lot.warehouseId, tx);
      await lockRow(tx, "inventoryLocations", locationId);
      const location = await tx.inventoryLocation.findFirst({ where: { id: locationId, warehouseId: warehouse.id, active: true } });
      if (!location) {
        throw Errors.validation({ locationId: ["Choose an open location in this warehouse"] });
      }
      if (lot.locationId === location.id) {
        throw Errors.invalidTransition("This stock is already in that location.");
      }
      const quantity = lot.quantityAvailable + lot.quantityReserved;
      if (quantity === 0) {
        throw Errors.invalidTransition("There's no stock left in this lot to move.");
      }
      const putAway = lot.locationId === null;
      await tx.stockLot.update({ where: { id: lot.id }, data: { locationId: location.id } });
      await this.ledger.record(
        tx,
        lot,
        principal.userId,
        { type: putAway ? "PUT_AWAY" : "MOVE", reference: { type: "inventory_location", id: location.id } },
        { type: putAway ? "PUT_AWAY" : "MOVED", quantity, fromLocationId: lot.locationId, toLocationId: location.id },
      );
      await this.audit.record(
        {
          actor: { userId: principal.userId, role: principal.role },
          action: putAway ? "lot.put_away" : "lot.moved",
          resourceType: "stock_lot",
          resourceId: lot.id,
          vendorId: lot.vendorId,
          countryCode: warehouse.countryCode,
          before: { locationId: lot.locationId },
          after: { locationId: location.id },
          meta,
        },
        tx,
      );
    });
    const [view] = await this.lots({ lotIds: [lotId] });
    return view!;
  }

  async vendorProductLabels(principal: AuthPrincipal, productIds: readonly string[]): Promise<LabelView[]> {
    const rows = await this.prisma.product.findMany({
      where: { vendorId: vendorIdOf(principal), id: { in: [...productIds] } },
      include: { barcodes: { orderBy: { createdAt: "asc" }, take: 1 } },
      orderBy: { code: "asc" },
    });
    return rows.map((row) => ({ code: row.code, productName: row.name, variantLabel: row.variantLabel, quantity: null, barcode: row.barcodes[0]?.value ?? row.code }));
  }

  async warehouseLotLabels(principal: AuthPrincipal, inboundId: string): Promise<LabelView[]> {
    const inbound = await this.prisma.inboundShipment.findUnique({ where: { id: inboundId } });
    if (!inbound) {
      throw Errors.notFound();
    }
    await this.warehouses.inScope(principal, inbound.warehouseId);
    const rows = await this.lotRows({ inboundId });
    return rows.map((lot) => ({ code: lot.code, productName: lot.product.name, variantLabel: lot.product.variantLabel, quantity: lot.quantityAvailable, barcode: lot.code }));
  }

  private async lots(filters: LotFilters): Promise<LotView[]> {
    return (await this.lotRows(filters)).map((lot) => ({
      id: lot.id,
      code: lot.code,
      productId: lot.productId,
      productCode: lot.product.code,
      productName: lot.product.name,
      vendorId: lot.vendorId,
      businessName: lot.vendor.businessName,
      warehouseId: lot.warehouseId,
      condition: lot.condition,
      storageTier: lot.storageTier,
      quantityAvailable: lot.quantityAvailable,
      quantityReserved: lot.quantityReserved,
      locationCode: lot.location?.code ?? null,
      inboundReference: lot.inbound.reference,
      receivedAt: lot.receivedAt.toISOString(),
    }));
  }

  private lotRows(filters: LotFilters): Promise<LotRow[]> {
    const holdsStock = !filters.lotIds && !filters.inboundId;
    return this.prisma.stockLot.findMany({
      where: {
        ...(filters.vendorId ? { vendorId: filters.vendorId } : {}),
        ...(filters.countryCode ? { warehouse: { countryCode: filters.countryCode } } : {}),
        ...(filters.warehouseId ? { warehouseId: filters.warehouseId } : {}),
        ...(filters.productId ? { productId: filters.productId } : {}),
        ...(filters.inboundId ? { inboundId: filters.inboundId } : {}),
        ...(filters.lotIds ? { id: { in: filters.lotIds } } : {}),
        ...(filters.unplacedOnly ? { locationId: null } : {}),
        ...(holdsStock ? { OR: [{ quantityAvailable: { gt: 0 } }, { quantityReserved: { gt: 0 } }] } : {}),
      },
      include: LOT_INCLUDE,
      orderBy: [{ product: { code: "asc" } }, { code: "asc" }],
      take: 1000,
    });
  }

  private async custody(lotId: string, showActor: boolean): Promise<CustodyEventView[]> {
    const rows = await this.prisma.custodyEvent.findMany({
      where: { lotId },
      include: { lot: { select: { code: true } }, actor: { select: { email: true } }, fromLocation: { select: { code: true } }, toLocation: { select: { code: true } } },
      orderBy: { sequence: "asc" },
    });
    return rows.map((event) => ({
      id: event.id,
      sequence: Number(event.sequence),
      type: event.type,
      lotCode: event.lot.code,
      fromLocation: event.fromLocation?.code ?? null,
      toLocation: event.toLocation?.code ?? null,
      quantity: event.quantity,
      actorEmail: showActor ? (event.actor?.email ?? null) : null,
      createdAt: event.createdAt.toISOString(),
    }));
  }
}
