import { Injectable } from "@nestjs/common";

import type { Prisma } from "../../../generated/prisma/client";
import type { CustodyEventType, MovementType } from "../../../shared";

export interface LedgerLot {
  id: string;
  vendorId: string;
  warehouseId: string;
}

export interface MovementEntry {
  type: MovementType;
  deltaAvailable?: number;
  deltaReserved?: number;
  reason?: string;
  reference?: { type: string; id: string };
}

export interface CustodyEntry {
  type: CustodyEventType;
  quantity: number;
  fromLocationId?: string | null;
  toLocationId?: string | null;
  evidenceFileIds?: readonly string[];
}

@Injectable()
export class InventoryLedgerService {
  async record(tx: Prisma.TransactionClient, lot: LedgerLot, actorId: string | null, movement: MovementEntry, custody: CustodyEntry): Promise<void> {
    await this.movement(tx, lot, actorId, movement);
    await this.custody(tx, lot, actorId, custody);
  }

  async movement(tx: Prisma.TransactionClient, lot: LedgerLot, actorId: string | null, movement: MovementEntry): Promise<void> {
    await tx.inventoryMovement.create({
      data: {
        vendorId: lot.vendorId,
        warehouseId: lot.warehouseId,
        lotId: lot.id,
        type: movement.type,
        deltaAvailable: movement.deltaAvailable ?? 0,
        deltaReserved: movement.deltaReserved ?? 0,
        reason: movement.reason ?? null,
        referenceType: movement.reference?.type ?? null,
        referenceId: movement.reference?.id ?? null,
        actorId,
      },
    });
  }

  async custody(tx: Prisma.TransactionClient, lot: LedgerLot, actorId: string | null, custody: CustodyEntry): Promise<void> {
    await tx.custodyEvent.create({
      data: {
        warehouseId: lot.warehouseId,
        vendorId: lot.vendorId,
        lotId: lot.id,
        type: custody.type,
        quantity: custody.quantity,
        fromLocationId: custody.fromLocationId ?? null,
        toLocationId: custody.toLocationId ?? null,
        actorId,
        evidenceFileIds: [...(custody.evidenceFileIds ?? [])],
      },
    });
  }
}
