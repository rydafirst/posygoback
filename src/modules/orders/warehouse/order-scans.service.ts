import { Injectable } from "@nestjs/common";

import type { AuthPrincipal } from "../../../common/auth/auth-principal";
import { Errors } from "../../../common/http/app-exception";
import { lockRow, PrismaService } from "../../../database/prisma.service";
import type { Order, Prisma } from "../../../generated/prisma/client";
import type { ScanResultView } from "../../../shared";
import { warehouseScope } from "../../stock/scope";
import { OrderTimelineService } from "../core/order-timeline.service";

const NO_MATCH = "00000000-0000-0000-0000-000000000000";

interface CountableLine {
  id: string;
  productName: string;
  quantity: number;
  scannedQuantity: number;
}

@Injectable()
export class OrderScansService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly timeline: OrderTimelineService,
  ) {}

  scan(principal: AuthPrincipal, orderId: string, code: string): Promise<ScanResultView> {
    return this.whilePacking(principal, orderId, async (tx, order) => {
      const lot = await tx.orderAllocation.findFirst({ where: { orderId, releasedAt: null, lot: { code: code.trim().toUpperCase() } }, select: { lineId: true } });
      const barcode = lot ? null : await tx.productBarcode.findFirst({ where: { vendorId: order.vendorId, value: code.trim() }, select: { productId: true } });
      const line = await tx.orderLine.findFirst({ where: { orderId, ...(lot ? { id: lot.lineId } : { productId: barcode?.productId ?? NO_MATCH }) } });
      if (!line) {
        throw Errors.validation({ code: [lot || barcode ? "That item isn't part of this order" : "That code doesn't match anything on this order"] });
      }
      return this.count(tx, line, "code");
    });
  }

  confirmUnit(principal: AuthPrincipal, orderId: string, lineId: string): Promise<ScanResultView> {
    return this.whilePacking(principal, orderId, async (tx) => {
      const line = await tx.orderLine.findFirst({ where: { id: lineId, orderId }, include: { product: { select: { _count: { select: { barcodes: true } } } } } });
      if (!line) {
        throw Errors.notFound();
      }
      if (line.product._count.barcodes > 0) {
        throw Errors.invalidTransition(`Scan the barcode on ${line.productName} instead.`);
      }
      const counted = await this.count(tx, line, "lineId");
      await this.timeline.add(tx, orderId, {
        type: "order.unit_confirmed",
        description: `${line.productName} checked by hand (${counted.scannedQuantity} of ${line.quantity})`,
        source: "STAFF",
        actorId: principal.userId,
      });
      return counted;
    });
  }

  async reset(principal: AuthPrincipal, orderId: string): Promise<void> {
    await this.whilePacking(principal, orderId, (tx) => tx.orderLine.updateMany({ where: { orderId }, data: { scannedQuantity: 0 } }));
  }

  private async whilePacking<Result>(principal: AuthPrincipal, orderId: string, work: (tx: Prisma.TransactionClient, order: Order) => Promise<Result>): Promise<Result> {
    const order = await this.prisma.order.findFirst({ where: { id: orderId, warehouse: warehouseScope(principal) }, select: { id: true } });
    if (!order) {
      throw Errors.notFound();
    }
    return this.prisma.$transaction(async (tx) => {
      await lockRow(tx, "orders", order.id);
      const current = await tx.order.findUniqueOrThrow({ where: { id: order.id } });
      if (current.status !== "PENDING_PACKING") {
        throw Errors.invalidTransition("Scanning is only for orders waiting to be packed.");
      }
      return work(tx, current);
    });
  }

  private async count(tx: Prisma.TransactionClient, line: CountableLine, field: string): Promise<ScanResultView> {
    if (line.scannedQuantity >= line.quantity) {
      throw Errors.validation({ [field]: [`All ${line.quantity} of ${line.productName} are already scanned`] });
    }
    const updated = await tx.orderLine.update({ where: { id: line.id }, data: { scannedQuantity: { increment: 1 } } });
    return { lineId: line.id, productName: line.productName, scannedQuantity: updated.scannedQuantity, quantity: line.quantity, complete: updated.scannedQuantity === line.quantity };
  }
}
