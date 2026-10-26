import { Injectable } from "@nestjs/common";

import { Errors } from "../../../common/http/app-exception";
import { Prisma } from "../../../generated/prisma/client";
import { InventoryLedgerService, type LedgerLot } from "../../stock/inventory/inventory-ledger.service";

export interface AllocationLine {
  lineId: string;
  productId: string;
  productName: string;
  quantity: number;
}

export interface AllocationOrder {
  id: string;
  vendorId: string;
  warehouseId: string;
}

interface LockedLot {
  id: string;
  product_id: string;
  quantity_available: number;
}

@Injectable()
export class StockAllocationService {
  constructor(private readonly ledger: InventoryLedgerService) {}

  async reserve(tx: Prisma.TransactionClient, order: AllocationOrder, lines: AllocationLine[], actorId: string | null): Promise<void> {
    const productIds = lines.map((line) => line.productId);
    const lots = await tx.$queryRaw<LockedLot[]>`
      SELECT id, product_id, quantity_available FROM stock_lots
      WHERE vendor_id = ${order.vendorId}::uuid AND warehouse_id = ${order.warehouseId}::uuid
        AND product_id IN (${Prisma.join(productIds.map((id) => Prisma.sql`${id}::uuid`))})
        AND condition = 'SELLABLE' AND quantity_available > 0
      ORDER BY received_at, id
      FOR UPDATE`;
    const short = lines.filter((line) => lots.filter((lot) => lot.product_id === line.productId).reduce((total, lot) => total + lot.quantity_available, 0) < line.quantity);
    if (short.length > 0) {
      throw Errors.insufficientStock(short.map((line) => line.productName));
    }
    for (const line of lines) {
      let needed = line.quantity;
      for (const lot of lots.filter((candidate) => candidate.product_id === line.productId)) {
        if (needed === 0) {
          break;
        }
        const take = Math.min(needed, lot.quantity_available);
        needed -= take;
        await tx.stockLot.update({ where: { id: lot.id }, data: { quantityAvailable: { decrement: take }, quantityReserved: { increment: take } } });
        await tx.orderAllocation.create({ data: { orderId: order.id, lineId: line.lineId, lotId: lot.id, quantity: take } });
        await this.ledger.movement(tx, this.lotRef(lot.id, order), actorId, { type: "RESERVE", deltaAvailable: -take, deltaReserved: take, reference: { type: "order", id: order.id } });
      }
    }
  }

  async pickAndPack(tx: Prisma.TransactionClient, order: AllocationOrder, actorId: string): Promise<void> {
    const allocations = await this.open(tx, order.id);
    for (const allocation of allocations) {
      const lot = this.lotRef(allocation.lotId, order);
      await this.ledger.custody(tx, lot, actorId, { type: "PICKED", quantity: allocation.quantity, fromLocationId: allocation.lot.locationId });
      await this.ledger.custody(tx, lot, actorId, { type: "PACKED", quantity: allocation.quantity });
    }
  }

  async ship(tx: Prisma.TransactionClient, order: AllocationOrder, actorId: string | null): Promise<void> {
    const allocations = await this.open(tx, order.id);
    for (const allocation of allocations) {
      await tx.stockLot.update({ where: { id: allocation.lotId }, data: { quantityReserved: { decrement: allocation.quantity } } });
      await tx.orderAllocation.update({ where: { id: allocation.id }, data: { shippedAt: new Date() } });
      await this.ledger.record(
        tx,
        this.lotRef(allocation.lotId, order),
        actorId,
        { type: "SHIP", deltaReserved: -allocation.quantity, reference: { type: "order", id: order.id } },
        { type: "HANDED_OFF", quantity: allocation.quantity },
      );
    }
  }

  async release(tx: Prisma.TransactionClient, order: AllocationOrder, actorId: string | null, packed: boolean): Promise<void> {
    const allocations = await this.open(tx, order.id);
    for (const allocation of allocations) {
      await tx.stockLot.update({ where: { id: allocation.lotId }, data: { quantityAvailable: { increment: allocation.quantity }, quantityReserved: { decrement: allocation.quantity } } });
      await tx.orderAllocation.update({ where: { id: allocation.id }, data: { releasedAt: new Date() } });
      const lot = this.lotRef(allocation.lotId, order);
      await this.ledger.movement(tx, lot, actorId, { type: "RELEASE", deltaAvailable: allocation.quantity, deltaReserved: -allocation.quantity, reference: { type: "order", id: order.id } });
      if (packed) {
        await this.ledger.custody(tx, lot, actorId, { type: "RELEASED", quantity: allocation.quantity, toLocationId: allocation.lot.locationId });
      }
    }
  }

  private async open(tx: Prisma.TransactionClient, orderId: string) {
    const allocations = await tx.orderAllocation.findMany({ where: { orderId, releasedAt: null, shippedAt: null }, include: { lot: { select: { locationId: true } } }, orderBy: { lotId: "asc" } });
    for (const allocation of allocations) {
      await tx.$queryRaw`SELECT 1 FROM stock_lots WHERE id = ${allocation.lotId}::uuid FOR UPDATE`;
    }
    return allocations;
  }

  private lotRef(lotId: string, order: AllocationOrder): LedgerLot {
    return { id: lotId, vendorId: order.vendorId, warehouseId: order.warehouseId };
  }
}
