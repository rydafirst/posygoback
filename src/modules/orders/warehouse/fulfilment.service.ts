import { Injectable } from "@nestjs/common";

import type { AuthPrincipal, RequestMeta } from "../../../common/auth/auth-principal";
import { Errors } from "../../../common/http/app-exception";
import { lockRow, PrismaService } from "../../../database/prisma.service";
import type { Order, Prisma } from "../../../generated/prisma/client";
import { AuditService } from "../../../infrastructure/audit/audit.service";
import {
  type CarrierTrackingEvent,
  hasPermission,
  OPEN_ORDER_STATUSES,
  orderActionAllowed,
  type OrderDetailView,
  type OrderStatus,
  type OrderSummaryView,
  type PackInput,
  type ScanResultView,
  type StaffOrderActionInput,
  staffOrderActions,
} from "../../../shared";
import { warehouseScope } from "../../stock/scope";
import { OrderCancellationService } from "../core/order-cancellation.service";
import type { OrderActor } from "../core/order-creation.service";
import { OrderShippingService } from "../core/order-shipping.service";
import { OrderTimelineService } from "../core/order-timeline.service";
import { OrderTrackingService } from "../core/order-tracking.service";
import { OrdersRepository } from "../core/orders.repository";
import { StockAllocationService } from "../core/stock-allocation.service";
import { DispatchEvidenceService } from "./dispatch-evidence.service";

export interface StaffQueueFilters {
  status?: OrderStatus;
  warehouseId?: string;
  q?: string;
}

function actorOf(principal: AuthPrincipal): OrderActor {
  return { userId: principal.userId, role: principal.role, apiKeyId: null };
}

@Injectable()
export class FulfilmentService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly orders: OrdersRepository,
    private readonly allocation: StockAllocationService,
    private readonly shipping: OrderShippingService,
    private readonly cancellation: OrderCancellationService,
    private readonly tracking: OrderTrackingService,
    private readonly timeline: OrderTimelineService,
    private readonly evidence: DispatchEvidenceService,
    private readonly audit: AuditService,
  ) {}

  async queue(principal: AuthPrincipal, filters: StaffQueueFilters): Promise<OrderSummaryView[]> {
    const search = filters.q?.trim();
    const rows = await this.orders.list(
      {
        ...this.scope(principal),
        ...(filters.warehouseId ? { warehouseId: filters.warehouseId } : {}),
        status: filters.status ?? { in: [...OPEN_ORDER_STATUSES] },
        ...(search
          ? {
              OR: [
                { reference: { contains: search, mode: "insensitive" } },
                { trackingNumber: { contains: search, mode: "insensitive" } },
                { recipientName: { contains: search, mode: "insensitive" } },
                { vendor: { businessName: { contains: search, mode: "insensitive" } } },
              ],
            }
          : {}),
      },
      100,
    );
    return this.masked(principal, rows);
  }

  async cancellationQueue(principal: AuthPrincipal): Promise<OrderSummaryView[]> {
    return this.masked(principal, await this.orders.list({ ...this.scope(principal), cancellations: { some: { status: "PENDING" } } }, 100));
  }

  private masked(principal: AuthPrincipal, rows: OrderSummaryView[]): OrderSummaryView[] {
    if (hasPermission(principal.role, "orders.fulfil") || hasPermission(principal.role, "orders.cancel")) {
      return rows;
    }
    return rows.map((row) => ({ ...row, recipientName: `${row.recipientName.slice(0, 1)}…` }));
  }

  async detail(principal: AuthPrincipal, orderId: string): Promise<OrderDetailView> {
    const row = await this.orders.detailRow({ id: orderId, ...this.scope(principal) });
    const can = { fulfil: hasPermission(principal.role, "orders.fulfil"), cancel: hasPermission(principal.role, "orders.cancel") };
    const view = this.orders.detail(row, "STAFF", staffOrderActions(row.status, can), can.fulfil || can.cancel);
    return principal.partnerId ? { ...view, charges: null, rates: view.rates.map((rate) => ({ ...rate, chargeMinor: null })) } : view;
  }

  async scan(principal: AuthPrincipal, orderId: string, code: string): Promise<ScanResultView> {
    const order = await this.inScope(principal, orderId);
    return this.prisma.$transaction(async (tx) => {
      const current = await this.locked(tx, order.id);
      if (current.status !== "PENDING_PACKING") {
        throw Errors.invalidTransition("Scanning is only for orders waiting to be packed.");
      }
      const normalised = code.trim().toUpperCase();
      const lot = await tx.orderAllocation.findFirst({ where: { orderId, releasedAt: null, lot: { code: normalised } }, select: { lineId: true } });
      const barcode = lot ? null : await tx.productBarcode.findFirst({ where: { vendorId: current.vendorId, value: code.trim() }, select: { productId: true } });
      const line = await tx.orderLine.findFirst({ where: { orderId, ...(lot ? { id: lot.lineId } : { productId: barcode?.productId ?? "00000000-0000-0000-0000-000000000000" }) } });
      if (!line) {
        throw Errors.validation({ code: [lot || barcode ? "That item isn't part of this order" : "That code doesn't match anything on this order"] });
      }
      if (line.scannedQuantity >= line.quantity) {
        throw Errors.validation({ code: [`All ${line.quantity} of ${line.productName} are already scanned`] });
      }
      const updated = await tx.orderLine.update({ where: { id: line.id }, data: { scannedQuantity: { increment: 1 } } });
      return { lineId: line.id, productName: line.productName, scannedQuantity: updated.scannedQuantity, quantity: line.quantity, complete: updated.scannedQuantity === line.quantity };
    });
  }

  async resetScans(principal: AuthPrincipal, orderId: string): Promise<OrderDetailView> {
    const order = await this.inScope(principal, orderId);
    await this.prisma.$transaction(async (tx) => {
      const current = await this.locked(tx, order.id);
      if (current.status !== "PENDING_PACKING") {
        throw Errors.invalidTransition("Scanning is only for orders waiting to be packed.");
      }
      await tx.orderLine.updateMany({ where: { orderId }, data: { scannedQuantity: 0 } });
    });
    return this.detail(principal, orderId);
  }

  async recordPack(principal: AuthPrincipal, orderId: string, input: PackInput, meta: RequestMeta): Promise<OrderDetailView> {
    const order = await this.inScope(principal, orderId);
    const preset = input.presetId ? await this.prisma.packagingPreset.findFirst({ where: { id: input.presetId, countryCode: order.originCountryCode, active: true } }) : null;
    if (input.presetId && !preset) {
      throw Errors.validation({ presetId: ["Choose one of this warehouse's packages"] });
    }
    const size = preset ? { lengthMm: preset.lengthMm, widthMm: preset.widthMm, heightMm: preset.heightMm } : input.dimensions!;
    await this.prisma.$transaction(async (tx) => {
      const current = await this.locked(tx, order.id);
      if (!orderActionAllowed("RECORD_PACK", current.status)) {
        throw Errors.invalidTransition("This order isn't waiting to be packed.");
      }
      const unscanned = await tx.orderLine.findMany({ where: { orderId, scannedQuantity: { lt: tx.orderLine.fields.quantity } }, select: { productName: true }, orderBy: { productCode: "asc" } });
      if (unscanned.length > 0) {
        throw Errors.invalidTransition(`Scan every item before packing. Still to scan: ${unscanned.map((line) => line.productName).join(", ")}.`);
      }
      await tx.order.update({
        where: { id: orderId },
        data: {
          status: "PACKING_COMPLETED",
          packagingPresetId: preset?.id ?? null,
          packedLengthMm: size.lengthMm,
          packedWidthMm: size.widthMm,
          packedHeightMm: size.heightMm,
          packedWeightGrams: input.weightGrams,
          packNotes: input.notes ?? null,
          packedBy: principal.userId,
          packedAt: new Date(),
        },
      });
      await this.allocation.pickAndPack(tx, current, principal.userId);
      await this.timeline.add(tx, orderId, {
        type: "order.packed",
        description: `Packed in ${preset ? preset.label : `a ${size.lengthMm / 10}×${size.widthMm / 10}×${size.heightMm / 10} cm parcel`}, ${(input.weightGrams / 1000).toFixed(2)} kg`,
        source: "STAFF",
        actorId: principal.userId,
      });
      await this.audit.record(
        {
          actor: actorOf(principal),
          action: "order.packed",
          resourceType: "order",
          resourceId: orderId,
          vendorId: current.vendorId,
          countryCode: current.originCountryCode,
          after: { weightGrams: input.weightGrams, ...size },
          meta,
        },
        tx,
      );
    });
    return this.detail(principal, orderId);
  }

  async act(principal: AuthPrincipal, orderId: string, input: StaffOrderActionInput, meta: RequestMeta): Promise<OrderDetailView> {
    const scope = this.scope(principal);
    const actor = actorOf(principal);
    const needs = input.action === "CANCEL" ? "orders.cancel" : "orders.fulfil";
    if (!hasPermission(principal.role, needs)) {
      throw Errors.notFound();
    }
    switch (input.action) {
      case "FETCH_RATES":
        await this.shipping.fetchRates(actor, orderId, scope);
        break;
      case "SELECT_RATE":
        await this.shipping.selectRate(actor, orderId, input.rateId, scope);
        break;
      case "RETRY_LABEL":
        await this.shipping.retryLabel(actor, orderId, scope);
        break;
      case "CANCEL":
        await this.cancellation.staffCancel(actor, orderId, scope, input.reason, input.note, meta);
        break;
      default:
        await this.move(principal, orderId, input, meta);
    }
    return this.detail(principal, orderId);
  }

  async decideCancellation(principal: AuthPrincipal, orderId: string, approve: boolean, note: string, meta: RequestMeta): Promise<OrderDetailView> {
    await this.cancellation.decide(actorOf(principal), orderId, this.scope(principal), approve, note, meta);
    return this.detail(principal, orderId);
  }

  async simulateTracking(principal: AuthPrincipal, orderId: string, event: CarrierTrackingEvent): Promise<OrderDetailView> {
    await this.inScope(principal, orderId);
    await this.tracking.simulate(orderId, event);
    return this.detail(principal, orderId);
  }

  async addDispatchPhotos(principal: AuthPrincipal, orderId: string, fileIds: string[], meta: RequestMeta): Promise<OrderDetailView> {
    await this.evidence.add(principal, orderId, fileIds, this.scope(principal), meta);
    return this.detail(principal, orderId);
  }

  private async move(principal: AuthPrincipal, orderId: string, input: Extract<StaffOrderActionInput, { action: "REPACK" | "HAND_OFF" | "HOLD" | "RELEASE" }>, meta: RequestMeta): Promise<void> {
    await this.inScope(principal, orderId);
    if (input.action === "HAND_OFF") {
      if (principal.partnerId && input.photoFileIds.length === 0) {
        throw Errors.validation({ photoFileIds: ["Add a photo of the sealed parcel with its label"] });
      }
      await this.evidence.assertOwn(principal, input.photoFileIds);
    }
    await this.prisma.$transaction(async (tx) => {
      const order = await this.locked(tx, orderId);
      if (!orderActionAllowed(input.action, order.status)) {
        throw Errors.invalidTransition("That step isn't available for this order right now.");
      }
      const description = await this.apply(tx, order, input, principal.userId);
      await this.timeline.add(tx, orderId, { type: `order.${input.action.toLowerCase()}`, description, source: "STAFF", actorId: principal.userId });
      await this.audit.record(
        {
          actor: actorOf(principal),
          action: `order.${input.action.toLowerCase()}`,
          resourceType: "order",
          resourceId: orderId,
          vendorId: order.vendorId,
          countryCode: order.originCountryCode,
          before: { status: order.status },
          meta,
        },
        tx,
      );
    });
  }

  private async apply(tx: Prisma.TransactionClient, order: Order, input: Extract<StaffOrderActionInput, { action: "REPACK" | "HAND_OFF" | "HOLD" | "RELEASE" }>, actorId: string): Promise<string> {
    switch (input.action) {
      case "HAND_OFF":
        const sealNumber = await this.evidence.seal(tx, order, input.sealNumber);
        await this.allocation.ship(tx, order, actorId);
        await this.evidence.shipped(tx, order, input.photoFileIds, actorId);
        await tx.order.update({ where: { id: order.id }, data: { status: "HANDED_OFF", handedOffAt: new Date(), sealNumber } });
        return `Handed to ${order.carrier ?? "the carrier"}`;
      case "HOLD":
        await tx.order.update({ where: { id: order.id }, data: { status: "ON_HOLD", statusBeforeHold: order.status, holdReason: input.reason } });
        return `Put on hold: ${input.reason}`;
      case "RELEASE":
      case "REPACK":
        await this.backToPacking(tx, order);
        return input.action === "RELEASE" ? "Hold released; the order goes back to packing" : "Sent back to packing";
    }
  }

  private async backToPacking(tx: Prisma.TransactionClient, order: Order): Promise<void> {
    await tx.orderRateQuote.updateMany({ where: { orderId: order.id, supersededAt: null }, data: { supersededAt: new Date() } });
    await tx.orderLine.updateMany({ where: { orderId: order.id }, data: { scannedQuantity: 0 } });
    await tx.order.update({
      where: { id: order.id },
      data: {
        status: "PENDING_PACKING",
        statusBeforeHold: null,
        holdReason: null,
        selectedRateId: null,
        packagingPresetId: null,
        packedLengthMm: null,
        packedWidthMm: null,
        packedHeightMm: null,
        packedWeightGrams: null,
        packNotes: null,
        packedBy: null,
        packedAt: null,
      },
    });
  }

  private scope(principal: AuthPrincipal): Prisma.OrderWhereInput {
    return { warehouse: warehouseScope(principal) };
  }

  private async inScope(principal: AuthPrincipal, orderId: string): Promise<Order> {
    const order = await this.prisma.order.findFirst({ where: { id: orderId, ...this.scope(principal) } });
    if (!order) {
      throw Errors.notFound();
    }
    return order;
  }

  private async locked(tx: Prisma.TransactionClient, orderId: string): Promise<Order> {
    await lockRow(tx, "orders", orderId);
    return tx.order.findUniqueOrThrow({ where: { id: orderId } });
  }
}
