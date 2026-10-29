import { Injectable } from "@nestjs/common";

import { Errors } from "../../../common/http/app-exception";
import { type DatabaseClient, PrismaService } from "../../../database/prisma.service";
import type { Prisma } from "../../../generated/prisma/client";
import { FieldEncryptionService } from "../../../infrastructure/crypto/field-encryption.service";
import { type OrderAction, type OrderDetailView, type OrderSummaryView, orderValueMinor, partnerProgramme, rankRates, type RateView, type Recipient } from "../../../shared";
import { recipientContext } from "./order-references";

export const ORDER_DETAIL_INCLUDE = {
  vendor: { select: { businessName: true } },
  warehouse: { select: { name: true, countryCode: true } },
  origin: { select: { config: true } },
  preset: { select: { label: true } },
  lines: {
    orderBy: { productCode: "asc" },
    include: {
      product: { select: { barcodes: { select: { value: true } } } },
      allocations: { where: { releasedAt: null }, include: { lot: { select: { code: true, location: { select: { code: true } } } } } },
    },
  },
  rates: { where: { supersededAt: null }, orderBy: { chargeMinor: "asc" } },
  events: { orderBy: { occurredAt: "asc" } },
  cancellations: { orderBy: { createdAt: "desc" }, take: 1 },
  _count: { select: { dispatchPhotos: true } },
} satisfies Prisma.OrderInclude;

const SUMMARY_INCLUDE = {
  vendor: { select: { businessName: true } },
  warehouse: { select: { name: true } },
  lines: { select: { quantity: true } },
  cancellations: { where: { status: "PENDING" }, select: { id: true } },
} satisfies Prisma.OrderInclude;

export type OrderDetailRow = Prisma.OrderGetPayload<{ include: typeof ORDER_DETAIL_INCLUDE }>;
type OrderSummaryRow = Prisma.OrderGetPayload<{ include: typeof SUMMARY_INCLUDE }>;

export type Audience = "VENDOR" | "STAFF";

@Injectable()
export class OrdersRepository {
  constructor(
    private readonly prisma: PrismaService,
    private readonly encryption: FieldEncryptionService,
  ) {}

  async list(where: Prisma.OrderWhereInput, take = 50): Promise<OrderSummaryView[]> {
    const rows = await this.prisma.order.findMany({ where, include: SUMMARY_INCLUDE, orderBy: [{ createdAt: "desc" }, { id: "desc" }], take });
    return rows.map((row) => this.summary(row));
  }

  async detailRow(where: Prisma.OrderWhereInput, client: DatabaseClient = this.prisma): Promise<OrderDetailRow> {
    const row = await client.order.findFirst({ where, include: ORDER_DETAIL_INCLUDE });
    if (!row) {
      throw Errors.notFound();
    }
    return row;
  }

  recipient(order: { id: string; recipientEncrypted: string }): Recipient {
    return JSON.parse(this.encryption.decrypt(order.recipientEncrypted, recipientContext(order.id))) as Recipient;
  }

  encryptRecipient(orderId: string, recipient: Recipient): string {
    return this.encryption.encrypt(JSON.stringify(recipient), recipientContext(orderId));
  }

  detail(row: OrderDetailRow, audience: Audience, actions: OrderAction[], revealRecipient = true): OrderDetailView {
    const pending = row.cancellations[0]?.status === "PENDING";
    const staff = audience === "STAFF";
    const request = row.cancellations[0];
    return {
      ...this.summary({ ...row, lines: row.lines, cancellations: pending ? [{ id: request!.id }] : [] }),
      recipient: revealRecipient ? this.recipient(row) : this.masked(row),
      holdReason: row.holdReason,
      lines: row.lines.map((line) => ({
        id: line.id,
        productId: line.productId,
        productCode: line.productCode,
        productName: line.productName,
        quantity: line.quantity,
        scannedQuantity: line.scannedQuantity,
        unitValueMinor: line.unitValueMinor,
        locations: staff ? [...new Set(line.allocations.map((allocation) => allocation.lot.location?.code ?? `${allocation.lot.code} (not shelved)`))] : [],
        barcodes: staff ? line.product.barcodes.map((barcode) => barcode.value) : [],
      })),
      charges: {
        currency: row.currency,
        fulfilmentFeeMinor: Number(row.fulfilmentFeeMinor),
        shippingChargeMinor: row.shippingChargeMinor === null ? null : Number(row.shippingChargeMinor),
        refundedMinor: Number(row.refundedMinor),
      },
      pack:
        row.packedAt && row.packedLengthMm && row.packedWidthMm && row.packedHeightMm && row.packedWeightGrams
          ? {
              presetLabel: row.preset?.label ?? null,
              lengthMm: row.packedLengthMm,
              widthMm: row.packedWidthMm,
              heightMm: row.packedHeightMm,
              weightGrams: row.packedWeightGrams,
              notes: staff ? row.packNotes : null,
              packedAt: row.packedAt.toISOString(),
            }
          : null,
      rates: this.rates(row, staff),
      label:
        row.trackingNumber && row.carrier && row.labelPurchasedAt
          ? {
              carrier: row.carrier,
              service: row.carrierService ?? "",
              trackingNumber: row.trackingNumber,
              labelUrl: staff ? row.labelUrl : null,
              trackingUrl: row.trackingUrl,
              purchasedAt: row.labelPurchasedAt.toISOString(),
              voidRequestedAt: row.labelVoidRequestedAt?.toISOString() ?? null,
            }
          : null,
      events: row.events.map((event) => ({ id: event.id, type: event.type, description: event.description, source: event.source, occurredAt: event.occurredAt.toISOString() })),
      cancellation: request
        ? { id: request.id, status: request.status, reason: request.reason, note: request.note, requestedAt: request.createdAt.toISOString(), decisionNote: request.decisionNote }
        : null,
      dispatchPhotoCount: staff ? row._count.dispatchPhotos : 0,
      sealRequired: staff && orderValueMinor(row.lines) >= partnerProgramme(row.origin.config as { partners?: unknown }).highValueOrderMinor,
      sealNumber: staff ? row.sealNumber : null,
      actions,
    };
  }

  private rates(row: OrderDetailRow, staff: boolean): RateView[] {
    const shown = row.rates.filter((rate) => staff || rate.id === row.selectedRateId);
    const ranking = rankRates(
      shown.map((rate) => ({ id: rate.id, chargeMinor: Number(rate.chargeMinor), estimatedDays: rate.estimatedDays, carrier: rate.carrier, service: rate.service })),
      row.deliveryPreference,
      row.preferredService,
    );
    const byId = new Map(shown.map((rate) => [rate.id, rate]));
    return ranking.order.map((id) => {
      const rate = byId.get(id)!;
      return {
        id: rate.id,
        carrier: rate.carrier,
        service: rate.service,
        chargeMinor: Number(rate.chargeMinor),
        currency: rate.currency,
        estimatedDays: rate.estimatedDays,
        selected: rate.id === row.selectedRateId,
        tags: ranking.tags.get(id) ?? [],
        preferred: id === ranking.preferredId,
      };
    });
  }

  private masked(row: OrderDetailRow): Recipient {
    return { name: `${row.recipientName.slice(0, 1)}…`, line1: "Hidden", city: row.recipientCity, postalCode: "", countryCode: row.originCountryCode };
  }

  private summary(row: OrderSummaryRow | (OrderDetailRow & { cancellations: Array<{ id: string }> })): OrderSummaryView {
    return {
      id: row.id,
      reference: row.reference,
      externalReference: row.externalReference,
      businessName: row.vendor.businessName,
      status: row.status,
      source: row.source,
      warehouseName: row.warehouse.name,
      countryCode: row.originCountryCode,
      recipientName: row.recipientName,
      recipientCity: row.recipientCity,
      totalUnits: row.lines.reduce((total, line) => total + line.quantity, 0),
      carrier: row.carrier,
      trackingNumber: row.trackingNumber,
      createdAt: row.createdAt.toISOString(),
      cancellationPending: row.cancellations.length > 0,
      deliveryPreference: row.deliveryPreference,
      preferredService: row.preferredService,
    };
  }
}
