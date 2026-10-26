import { Injectable } from "@nestjs/common";

import { lockRow, PrismaService } from "../../../database/prisma.service";
import { AuditService } from "../../../infrastructure/audit/audit.service";
import type { CarrierAdapter, PurchasedLabel } from "../carriers/carrier.port";
import type { OrderActor } from "./order-creation.service";
import { OrderTimelineService } from "./order-timeline.service";

@Injectable()
export class LabelRecordsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly timeline: OrderTimelineService,
    private readonly audit: AuditService,
  ) {}

  record(orderId: string, label: PurchasedLabel, actor: OrderActor): Promise<boolean> {
    return this.prisma.$transaction(async (tx) => {
      await lockRow(tx, "orders", orderId);
      const current = await tx.order.findUniqueOrThrow({ where: { id: orderId } });
      if (current.status !== "SHIPPING_PAID") {
        return false;
      }
      await tx.order.update({
        where: { id: orderId },
        data: {
          status: "LABEL_PURCHASED",
          carrier: label.carrier,
          carrierCode: label.carrierCode,
          carrierService: label.service,
          trackingNumber: label.trackingNumber,
          trackingUrl: label.trackingUrl,
          labelUrl: label.labelUrl,
          labelTransactionId: label.transactionId,
          labelPurchasedBy: actor.userId,
          labelPurchasedAt: new Date(),
        },
      });
      await this.timeline.add(tx, orderId, {
        type: "label.purchased",
        description: `${label.carrier} ${label.service} label bought, tracking ${label.trackingNumber}`,
        source: actor.role && actor.userId ? "STAFF" : "SYSTEM",
        actorId: actor.userId,
      });
      return true;
    });
  }

  async voidLabel(orderId: string, adapter: CarrierAdapter, transactionId: string, reason: string): Promise<void> {
    const voided = await adapter.voidLabel(transactionId).catch(() => false);
    await this.prisma.$transaction(async (tx) => {
      await this.timeline.add(tx, orderId, {
        type: voided ? "label.voided" : "label.void_failed",
        description: voided ? reason : `${reason.replace("was voided", "couldn't be voided")} Void it in the carrier account.`,
        source: "SYSTEM",
      });
      await this.audit.record(
        { actor: { userId: null, role: null }, action: voided ? "order.label_voided" : "order.label_void_failed", resourceType: "order", resourceId: orderId, after: { transactionId, reason } },
        tx,
      );
    });
  }

  async unconfirmed(orderId: string, reason: string): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      await this.timeline.add(tx, orderId, { type: "label.unconfirmed", description: `The carrier didn't confirm the label: ${reason}`, source: "SYSTEM" });
      await this.audit.record({ actor: { userId: null, role: null }, action: "order.label_unconfirmed", resourceType: "order", resourceId: orderId, after: { reason } }, tx);
    });
  }
}
