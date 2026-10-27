import { Injectable, Logger } from "@nestjs/common";

import type { RequestMeta } from "../../../common/auth/auth-principal";
import { Errors } from "../../../common/http/app-exception";
import { isUniqueViolation, lockRow, PrismaService } from "../../../database/prisma.service";
import type { OrderEventSource, OrderStatus, Prisma } from "../../../generated/prisma/client";
import { AuditService } from "../../../infrastructure/audit/audit.service";
import { type CancellationReason, ORDER_STATUSES, orderActionAllowed, VENDOR_CANCELLABLE } from "../../../shared";
import { CarrierAccountsService } from "../carriers/carrier-accounts.service";
import { OrderEmails } from "../order-emails";
import { OrderAlertsService } from "./order-alerts.service";
import type { OrderActor } from "./order-creation.service";
import { OrderChargesService } from "./order-charges.service";
import { OrderTimelineService } from "./order-timeline.service";
import { StockAllocationService } from "./stock-allocation.service";

const REASON_TEXT: Record<CancellationReason, string> = {
  CUSTOMER_CANCELLED: "The customer cancelled",
  WRONG_ITEMS: "Wrong items ordered",
  ADDRESS_PROBLEM: "Problem with the address",
  OUT_OF_STOCK: "Out of stock",
  OTHER: "Other",
};

interface CancelRequest {
  reason: CancellationReason;
  note?: string;
  source: OrderEventSource;
  allowed: readonly OrderStatus[];
  decisionNote?: string;
}

@Injectable()
export class OrderCancellationService {
  private readonly logger = new Logger(OrderCancellationService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly allocation: StockAllocationService,
    private readonly charges: OrderChargesService,
    private readonly timeline: OrderTimelineService,
    private readonly carriers: CarrierAccountsService,
    private readonly owners: OrderAlertsService,
    private readonly audit: AuditService,
  ) {}

  vendorCancel(actor: OrderActor, orderId: string, scope: Prisma.OrderWhereInput, reason: CancellationReason, note: string | undefined, meta: RequestMeta) {
    return this.cancel(actor, orderId, scope, { reason, note, source: "VENDOR", allowed: VENDOR_CANCELLABLE }, meta);
  }

  staffCancel(actor: OrderActor, orderId: string, scope: Prisma.OrderWhereInput, reason: CancellationReason, note: string, meta: RequestMeta) {
    return this.cancel(actor, orderId, scope, { reason, note, source: "STAFF", allowed: this.staffCancellable() }, meta);
  }

  async request(actor: OrderActor, orderId: string, scope: Prisma.OrderWhereInput, reason: CancellationReason, note: string | undefined, meta: RequestMeta): Promise<void> {
    await this.inScope(orderId, scope);
    try {
      await this.prisma.$transaction(async (tx) => {
        await lockRow(tx, "orders", orderId);
        const order = await tx.order.findUniqueOrThrow({ where: { id: orderId } });
        if (!orderActionAllowed("REQUEST_CANCELLATION", order.status)) {
          throw Errors.invalidTransition(VENDOR_CANCELLABLE.includes(order.status) ? "You can cancel this order directly." : "This order can no longer be cancelled.");
        }
        await tx.orderCancellationRequest.create({ data: { orderId, reason, note: note ?? null, requestedBy: actor.userId! } });
        await this.timeline.add(tx, orderId, { type: "cancellation.requested", description: `Cancellation requested: ${REASON_TEXT[reason]}`, source: "VENDOR", actorId: actor.userId });
        await this.audit.record(
          { actor: { userId: actor.userId, role: actor.role }, action: "order.cancellation_requested", resourceType: "order", resourceId: orderId, vendorId: order.vendorId, after: { reason }, meta },
          tx,
        );
      });
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw Errors.invalidTransition("A cancellation request is already waiting for this order.");
      }
      throw error;
    }
  }

  async decide(actor: OrderActor, orderId: string, scope: Prisma.OrderWhereInput, approve: boolean, note: string, meta: RequestMeta): Promise<void> {
    await this.inScope(orderId, scope);
    const request = await this.prisma.orderCancellationRequest.findFirst({ where: { orderId, status: "PENDING" } });
    if (!request) {
      throw Errors.invalidTransition("There's no cancellation request waiting for this order.");
    }
    if (approve) {
      await this.cancel(actor, orderId, scope, { reason: request.reason, note: request.note ?? undefined, source: "STAFF", allowed: this.staffCancellable(), decisionNote: note }, meta);
      return;
    }
    const decided = await this.prisma.$transaction(async (tx) => {
      await lockRow(tx, "orders", orderId);
      const updated = await tx.orderCancellationRequest.updateMany({
        where: { id: request.id, status: "PENDING" },
        data: { status: "REJECTED", decidedBy: actor.userId, decisionNote: note, decidedAt: new Date() },
      });
      if (updated.count === 0) {
        throw Errors.invalidTransition("This request has already been decided.");
      }
      const order = await tx.order.findUniqueOrThrow({ where: { id: orderId } });
      await this.timeline.add(tx, orderId, { type: "cancellation.rejected", description: `Cancellation declined: ${note}`, source: "STAFF", actorId: actor.userId });
      await this.audit.record(
        { actor: { userId: actor.userId, role: actor.role }, action: "order.cancellation_rejected", resourceType: "order", resourceId: orderId, vendorId: order.vendorId, after: { note }, meta },
        tx,
      );
      return order;
    });
    await this.owners.tellOwner(decided, (to, webUrl) => OrderEmails.cancellationRejected(to, decided, note, webUrl));
  }

  private async cancel(actor: OrderActor, orderId: string, scope: Prisma.OrderWhereInput, request: CancelRequest, meta: RequestMeta): Promise<void> {
    await this.inScope(orderId, scope);
    const cancelled = await this.prisma.$transaction(async (tx) => {
      await lockRow(tx, "orders", orderId);
      const order = await tx.order.findUniqueOrThrow({ where: { id: orderId } });
      if (!request.allowed.includes(order.status)) {
        throw Errors.invalidTransition(request.source === "VENDOR" ? "Packing has started, so ask us to cancel instead." : "This order can no longer be cancelled.");
      }
      await this.allocation.release(tx, order, actor.userId, order.packedAt !== null);
      const refunded = await this.charges.refundEverything(tx, order, actor.userId);
      await tx.order.update({
        where: { id: orderId },
        data: {
          status: "CANCELLED",
          cancelledAt: new Date(),
          cancelReason: request.reason,
          cancelNote: request.note ?? null,
          labelVoidRequestedAt: order.labelTransactionId ? new Date() : null,
          selectedRateId: null,
        },
      });
      const pending = await tx.orderCancellationRequest.findFirst({ where: { orderId, status: "PENDING" } });
      if (pending) {
        await tx.orderCancellationRequest.update({
          where: { id: pending.id },
          data: { status: "APPROVED", decidedBy: pending.requestedBy === actor.userId ? null : actor.userId, decisionNote: request.decisionNote ?? "Order cancelled", decidedAt: new Date() },
        });
      }
      await this.timeline.add(tx, orderId, {
        type: "order.cancelled",
        description: `Order cancelled: ${REASON_TEXT[request.reason]}${request.note ? ` (${request.note})` : ""}`,
        source: request.source,
        actorId: actor.userId,
      });
      await this.audit.record(
        {
          actor: { userId: actor.userId, role: actor.role },
          action: "order.cancelled",
          resourceType: "order",
          resourceId: orderId,
          vendorId: order.vendorId,
          countryCode: order.originCountryCode,
          after: { reason: request.reason, refundedMinor: refunded },
          meta,
        },
        tx,
      );
      return order;
    });
    if (cancelled.labelTransactionId) {
      await this.voidLabel(cancelled.id, cancelled.originCountryCode, cancelled.labelTransactionId);
    }
    if (request.source === "STAFF") {
      const reason = request.decisionNote ?? request.note ?? REASON_TEXT[request.reason];
      await this.owners.tellOwner(cancelled, (to, webUrl) => OrderEmails.cancelled(to, cancelled, reason, webUrl));
    }
  }

  private async voidLabel(orderId: string, countryCode: string, transactionId: string): Promise<void> {
    const voided = await this.carriers
      .forCountry(countryCode)
      .adapter.voidLabel(transactionId)
      .catch((error: unknown) => {
        this.logger.error(`Label void failed for order ${orderId}: ${String(error)}`);
        return false;
      });
    await this.prisma.$transaction(async (tx) => {
      await this.timeline.add(tx, orderId, {
        type: voided ? "label.void_requested" : "label.void_failed",
        description: voided ? "The carrier has been asked to refund the label" : "The carrier didn't accept the label refund. Void it in the carrier account.",
        source: "SYSTEM",
      });
      if (!voided) {
        await this.audit.record({ actor: { userId: null, role: null }, action: "order.label_void_failed", resourceType: "order", resourceId: orderId, after: { transactionId } }, tx);
      }
    });
  }

  private staffCancellable(): OrderStatus[] {
    return ORDER_STATUSES.filter((status) => orderActionAllowed("CANCEL", status));
  }

  private async inScope(orderId: string, scope: Prisma.OrderWhereInput): Promise<void> {
    if (!(await this.prisma.order.findFirst({ where: { id: orderId, ...scope }, select: { id: true } }))) {
      throw Errors.notFound();
    }
  }
}
