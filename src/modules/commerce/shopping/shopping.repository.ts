import { Injectable } from "@nestjs/common";

import type { Prisma } from "../../../generated/prisma/client";
import { FieldEncryptionService } from "../../../infrastructure/crypto/field-encryption.service";
import type { CustomsItem } from "../../orders/carriers/carrier.port";
import type { DeliverySpeed, ShipTo, ShoppingDeliveryOptionView, ShoppingRequestView } from "../../../shared";

export const SHOPPING_INCLUDE = { lines: { orderBy: { position: "asc" } }, warehouse: { select: { name: true } } } satisfies Prisma.ShoppingRequestInclude;

export type ShoppingRow = Prisma.ShoppingRequestGetPayload<{ include: typeof SHOPPING_INCLUDE }>;
export type ShoppingAudience = "BUYER" | "STAFF" | "WAREHOUSE";

export interface StoredParcel {
  packagingPresetId: string;
  lengthMm: number;
  widthMm: number;
  heightMm: number;
  weightGrams: number;
  options: ShoppingDeliveryOptionView[];
  customs: CustomsItem[] | null;
  speed?: DeliverySpeed;
}

const shipToContext = (requestId: string) => `shopping_request:${requestId}:ship_to`;

@Injectable()
export class ShoppingRepository {
  constructor(private readonly encryption: FieldEncryptionService) {}

  encryptShipTo(requestId: string, shipTo: ShipTo): string {
    return this.encryption.encrypt(JSON.stringify(shipTo), shipToContext(requestId));
  }

  shipTo(row: { id: string; recipientEncrypted: string }): ShipTo {
    return JSON.parse(this.encryption.decrypt(row.recipientEncrypted, shipToContext(row.id))) as ShipTo;
  }

  parcel(row: { parcel: unknown }): StoredParcel | null {
    return (row.parcel as StoredParcel | null) ?? null;
  }

  view(row: ShoppingRow, audience: ShoppingAudience): ShoppingRequestView {
    const staff = audience !== "BUYER";
    const warehouse = audience === "WAREHOUSE";
    return {
      id: row.id,
      reference: row.reference,
      countryCode: row.countryCode,
      currency: row.currency,
      status: row.status,
      buyerName: row.buyerName,
      buyerEmail: warehouse ? null : row.buyerEmail,
      recipientCity: row.recipientCity,
      destinationCountryCode: row.destinationCountryCode,
      shipTo: warehouse ? null : this.shipTo(row),
      notes: warehouse ? null : row.notes,
      confirmed: row.confirmedAt !== null,
      disputeOpen: row.disputeOpen,
      lines: row.lines.map((line) => ({
        id: line.id,
        url: line.url,
        description: line.description,
        quantity: line.quantity,
        status: line.status,
        unitPriceMinor: line.unitPriceMinor === null ? null : Number(line.unitPriceMinor),
        unitWeightGrams: staff ? line.unitWeightGrams : null,
        hsCode: staff ? line.hsCode : null,
        staffNote: line.staffNote,
        retailerOrderRef: staff && !warehouse ? line.retailerOrderRef : null,
        receivedQuantity: line.receivedQuantity,
      })),
      goodsMinor: Number(row.goodsMinor),
      commissionMinor: Number(row.commissionMinor),
      deliveryMinor: Number(row.deliveryMinor),
      totalMinor: Number(row.totalMinor),
      refundedMinor: Number(row.refundedMinor),
      deliveryOptions: this.parcel(row)?.options ?? [],
      quoteExpiresAt: row.quoteExpiresAt?.toISOString() ?? null,
      warehouseName: row.warehouse?.name ?? null,
      arrivalPhotoFileIds: staff ? (row.arrivalPhotoFileIds as string[]) : [],
      carrier: row.carrier,
      trackingNumber: row.trackingNumber,
      trackingUrl: row.trackingUrl,
      cancelReason: row.cancelReason,
      createdAt: row.createdAt.toISOString(),
      paidAt: row.paidAt?.toISOString() ?? null,
      shippedAt: row.shippedAt?.toISOString() ?? null,
    };
  }
}
