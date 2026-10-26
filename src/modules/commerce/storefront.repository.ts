import { Injectable } from "@nestjs/common";

import type { Prisma } from "../../generated/prisma/client";
import { FieldEncryptionService } from "../../infrastructure/crypto/field-encryption.service";
import type { DeliverySpeed, ShipTo, StorefrontOrderView, StorefrontReturnView } from "../../shared";

export const STOREFRONT_ORDER_INCLUDE = {
  vendor: { select: { businessName: true, storefront: { select: { displayName: true, slug: true } } } },
  lines: { orderBy: { productName: "asc" } },
  fulfilmentOrder: { select: { reference: true, trackingNumber: true, status: true } },
  returns: { orderBy: { createdAt: "desc" } },
} satisfies Prisma.StorefrontOrderInclude;

export type StorefrontOrderRow = Prisma.StorefrontOrderGetPayload<{ include: typeof STOREFRONT_ORDER_INCLUDE }>;

export type OrderAudience = "STAFF" | "VENDOR" | "BUYER" | "RECEIPT";
export type ReturnRow = StorefrontOrderRow["returns"][number];

const RETURNABLE_STATUSES = new Set(["SHIPPED", "DELIVERED"]);
const OPEN_RETURN_STATUSES = new Set(["REQUESTED", "APPROVED"]);
const PAYOUT_NOT_SENT = new Set(["HELD", "FAILED"]);

type ReturnableOrder = Pick<StorefrontOrderRow, "status" | "returnsUntil" | "refundedMinor" | "totalMinor" | "payoutStatus"> & { returns: Pick<ReturnRow, "status">[] };

export function returnBlocker(order: ReturnableOrder, now = new Date()): string | null {
  if (!RETURNABLE_STATUSES.has(order.status) || order.refundedMinor >= order.totalMinor || !PAYOUT_NOT_SENT.has(order.payoutStatus)) {
    return "This order can't be returned right now.";
  }
  if (!order.returnsUntil) {
    return "This store doesn't take returns.";
  }
  if (order.returnsUntil <= now) {
    return "The return window for this order has closed.";
  }
  return order.returns.some((entry) => OPEN_RETURN_STATUSES.has(entry.status)) ? "There's already a return open for this order." : null;
}

export function returnView(row: ReturnRow): StorefrontReturnView {
  return {
    id: row.id,
    reference: row.reference,
    status: row.status,
    reason: row.reason,
    decisionNote: row.decisionNote,
    refundMinor: row.refundMinor === null ? null : Number(row.refundMinor),
    createdAt: row.createdAt.toISOString(),
    decidedAt: row.decidedAt?.toISOString() ?? null,
  };
}

const shipToContext = (orderId: string) => `storefront_order:${orderId}:ship_to`;

@Injectable()
export class StorefrontRepository {
  constructor(private readonly encryption: FieldEncryptionService) {}

  encryptShipTo(orderId: string, shipTo: ShipTo): string {
    return this.encryption.encrypt(JSON.stringify(shipTo), shipToContext(orderId));
  }

  shipTo(order: { id: string; recipientEncrypted: string }): ShipTo {
    return JSON.parse(this.encryption.decrypt(order.recipientEncrypted, shipToContext(order.id))) as ShipTo;
  }

  view(row: StorefrontOrderRow, audience: OrderAudience): StorefrontOrderView {
    const money = audience === "STAFF" || audience === "VENDOR";
    const receipt = audience === "RECEIPT";
    return {
      id: row.id,
      reference: row.reference,
      storeName: row.vendor.storefront?.displayName ?? row.vendor.businessName,
      storeSlug: row.vendor.storefront?.slug ?? null,
      status: row.status,
      currency: row.currency,
      buyerName: receipt ? "" : row.buyerName,
      buyerEmail: audience === "STAFF" || audience === "BUYER" ? row.buyerEmail : null,
      recipientCity: receipt ? "" : row.recipientCity,
      destinationCountryCode: row.destinationCountryCode,
      lines: row.lines.map((line) => ({ productId: line.productId, productName: line.productName, quantity: line.quantity, unitPriceMinor: line.unitPriceMinor })),
      goodsMinor: Number(row.goodsMinor),
      discountMinor: Number(row.discountMinor),
      deliverySpeed: row.deliverySpeed as DeliverySpeed,
      deliveryMinor: Number(row.deliveryMinor),
      taxMinor: Number(row.taxMinor),
      taxIncluded: row.taxIncluded,
      totalMinor: Number(row.totalMinor),
      refundedMinor: Number(row.refundedMinor),
      vendorShareMinor: money ? Number(row.vendorShareMinor) : null,
      platformShareMinor: audience === "STAFF" ? Number(row.platformShareMinor) : null,
      payoutStatus: money ? row.payoutStatus : null,
      payoutReleaseAt: money ? (row.payoutReleaseAt?.toISOString() ?? null) : null,
      returnsUntil: row.returnsUntil?.toISOString() ?? null,
      canRequestReturn: !receipt && returnBlocker(row) === null,
      returns: receipt ? [] : row.returns.map(returnView),
      fulfilmentReference: !money ? null : (row.fulfilmentOrder?.reference ?? null),
      trackingNumber: row.fulfilmentOrder?.trackingNumber ?? null,
      paidAt: row.paidAt?.toISOString() ?? null,
      createdAt: row.createdAt.toISOString(),
    };
  }
}
