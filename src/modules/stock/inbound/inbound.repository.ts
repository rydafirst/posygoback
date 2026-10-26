import { Injectable } from "@nestjs/common";

import { Errors } from "../../../common/http/app-exception";
import { PrismaService } from "../../../database/prisma.service";
import type { InboundShipment, Prisma } from "../../../generated/prisma/client";
import { type BoxCounts, type InboundDetailView, type InboundStatus, type InboundSummaryView, totalBoxes } from "../../../shared";
import { fromDateOnly } from "../scope";

export type InboundRow = InboundShipment;

export interface InboundFilters {
  vendorId?: string;
  countryCode?: string | null;
  warehouse?: Prisma.WarehouseWhereInput;
  statuses?: readonly InboundStatus[];
}

const SUMMARY_INCLUDE = { vendor: { select: { businessName: true } }, warehouse: { select: { name: true } }, lines: { select: { declaredQuantity: true } } } satisfies Prisma.InboundShipmentInclude;

type SummaryRow = Prisma.InboundShipmentGetPayload<{ include: typeof SUMMARY_INCLUDE }>;

@Injectable()
export class InboundRepository {
  constructor(private readonly prisma: PrismaService) {}

  async summaries(filters: InboundFilters): Promise<InboundSummaryView[]> {
    const rows = await this.prisma.inboundShipment.findMany({
      where: {
        ...(filters.vendorId ? { vendorId: filters.vendorId } : {}),
        ...(filters.countryCode ? { countryCode: filters.countryCode } : {}),
        ...(filters.warehouse ? { warehouse: filters.warehouse } : {}),
        ...(filters.statuses ? { status: { in: [...filters.statuses] } } : {}),
      },
      include: SUMMARY_INCLUDE,
      orderBy: filters.vendorId ? { createdAt: "desc" } : { expectedArrivalDate: "asc" },
      take: 300,
    });
    return rows.map((row) => this.summary(row));
  }

  async detail(inboundId: string): Promise<Omit<InboundDetailView, "actions">> {
    const row = await this.prisma.inboundShipment.findUnique({
      where: { id: inboundId },
      include: {
        ...SUMMARY_INCLUDE,
        lines: { include: { product: { select: { code: true, name: true } } }, orderBy: { product: { code: "asc" } } },
        photos: { orderBy: { createdAt: "asc" } },
        messages: { include: { author: { select: { email: true } } }, orderBy: { createdAt: "asc" } },
        country: { select: { currency: true } },
      },
    });
    if (!row) {
      throw Errors.notFound();
    }
    const counted = row.receivedAt !== null;
    return {
      ...this.summary(row),
      charges: {
        currency: row.country.currency,
        onboardingFeeMinor: row.onboardingFeeMinor === null ? null : Number(row.onboardingFeeMinor),
        onboardingChargedAt: row.onboardingChargedAt?.toISOString() ?? null,
        holdChargeMinor: row.holdChargeMinor === null ? null : Number(row.holdChargeMinor),
        holdPaidAt: row.holdPaidAt?.toISOString() ?? null,
      },
      carrier: row.carrier,
      trackingNumber: row.trackingNumber,
      notes: row.notes,
      declaredBoxCounts: row.declaredBoxCounts as BoxCounts,
      receivedBoxCounts: row.receivedBoxCounts as BoxCounts | null,
      statusReason: row.statusReason,
      receivingNote: row.receivingNote,
      arrivedAt: row.arrivedAt?.toISOString() ?? null,
      receivedAt: row.receivedAt?.toISOString() ?? null,
      lines: row.lines.map((line) => {
        const total = line.acceptedQuantity + line.damagedQuantity;
        return {
          id: line.id,
          productId: line.productId,
          productCode: line.product.code,
          productName: line.product.name,
          declaredQuantity: line.declaredQuantity,
          acceptedQuantity: line.acceptedQuantity,
          damagedQuantity: line.damagedQuantity,
          missingQuantity: counted ? Math.max(line.declaredQuantity - total, 0) : 0,
          extraQuantity: counted ? Math.max(total - line.declaredQuantity, 0) : 0,
          note: line.note,
        };
      }),
      photos: row.photos.map((photo) => ({ fileId: photo.fileId, lineId: photo.lineId })),
      messages: row.messages.map((message) => ({
        id: message.id,
        fromPlatform: message.fromPlatform,
        authorEmail: message.fromPlatform ? null : message.author.email,
        body: message.body,
        createdAt: message.createdAt.toISOString(),
      })),
    };
  }

  async find(inboundId: string): Promise<InboundRow | undefined> {
    return (await this.prisma.inboundShipment.findUnique({ where: { id: inboundId } })) ?? undefined;
  }

  async hasPhoto(inboundId: string, fileId: string): Promise<boolean> {
    return (await this.prisma.inboundPhoto.count({ where: { inboundId, fileId } })) > 0;
  }

  private summary(row: InboundRow & Pick<SummaryRow, "vendor" | "warehouse"> & { lines: Array<{ declaredQuantity: number }> }): InboundSummaryView {
    return {
      id: row.id,
      reference: row.reference,
      vendorId: row.vendorId,
      businessName: row.vendor.businessName,
      warehouseId: row.warehouseId,
      warehouseName: row.warehouse.name,
      countryCode: row.countryCode,
      status: row.status,
      shippingMode: row.shippingMode,
      expectedArrivalDate: fromDateOnly(row.expectedArrivalDate),
      totalUnits: row.lines.reduce((total, line) => total + line.declaredQuantity, 0),
      totalBoxes: totalBoxes(row.declaredBoxCounts as BoxCounts),
      submittedAt: row.submittedAt?.toISOString() ?? null,
      updatedAt: row.updatedAt.toISOString(),
    };
  }
}
