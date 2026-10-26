import { Injectable } from "@nestjs/common";

import { PrismaService } from "../../database/prisma.service";
import type { Prisma } from "../../generated/prisma/client";
import { RETURN_RULES, type VendorReturnView } from "../../shared";

const DAY_MS = 24 * 60 * 60 * 1000;

export const VENDOR_RETURN_INCLUDE = {
  order: { select: { reference: true } },
  vendor: { select: { businessName: true } },
  warehouse: { select: { name: true, addressLines: true, city: true, postalCode: true } },
  lines: { include: { orderLine: { select: { productName: true, productCode: true } } }, orderBy: { orderLine: { productName: "asc" } } },
} satisfies Prisma.VendorReturnInclude;

export type VendorReturnRow = Prisma.VendorReturnGetPayload<{ include: typeof VENDOR_RETURN_INCLUDE }>;
export type ReturnAudience = "VENDOR" | "WAREHOUSE";

const ACTIVE: Prisma.VendorReturnWhereInput["status"] = { in: ["REQUESTED", "RECEIVED", "INSTRUCTED"] };
const PAGE = 100;

export function addDays(from: Date, days: number): Date {
  return new Date(from.getTime() + days * DAY_MS);
}

@Injectable()
export class VendorReturnsRepository {
  constructor(private readonly prisma: PrismaService) {}

  async list(where: Prisma.VendorReturnWhereInput, audience: ReturnAudience): Promise<VendorReturnView[]> {
    const rows = await this.prisma.vendorReturn.findMany({ where, include: VENDOR_RETURN_INCLUDE, orderBy: { createdAt: "desc" }, take: PAGE });
    return rows.map((row) => this.view(row, audience));
  }

  async find(where: Prisma.VendorReturnWhereInput): Promise<VendorReturnRow | null> {
    return this.prisma.vendorReturn.findFirst({ where, include: VENDOR_RETURN_INCLUDE });
  }

  async returnedSoFar(client: Prisma.TransactionClient, orderId: string): Promise<Map<string, number>> {
    const lines = await client.vendorReturnLine.findMany({
      where: { vendorReturn: { orderId, OR: [{ status: ACTIVE }, { status: "COMPLETED" }] } },
      select: { orderLineId: true, requestedQuantity: true, receivedQuantity: true, vendorReturn: { select: { status: true } } },
    });
    const counted = new Map<string, number>();
    for (const line of lines) {
      const quantity = line.vendorReturn.status === "COMPLETED" ? (line.receivedQuantity ?? 0) : line.requestedQuantity;
      counted.set(line.orderLineId, (counted.get(line.orderLineId) ?? 0) + quantity);
    }
    return counted;
  }

  view(row: VendorReturnRow, audience: ReturnAudience): VendorReturnView {
    return {
      id: row.id,
      reference: row.reference,
      status: row.status,
      orderId: row.orderId,
      orderReference: row.order.reference,
      vendorName: audience === "WAREHOUSE" ? row.vendor.businessName : null,
      warehouseName: row.warehouse.name,
      returnAddress:
        audience === "VENDOR" && row.status === "REQUESTED"
          ? { name: row.warehouse.name, addressLines: row.warehouse.addressLines as string[], city: row.warehouse.city, postalCode: row.warehouse.postalCode }
          : null,
      reason: row.reason,
      carrier: row.carrier,
      trackingNumber: row.trackingNumber,
      feeMinor: Number(row.feeMinor),
      currency: row.currency,
      createdAt: row.createdAt.toISOString(),
      receiveBy: addDays(row.createdAt, RETURN_RULES.receiveDays).toISOString(),
      receivedAt: row.receivedAt?.toISOString() ?? null,
      receiveNotes: row.receiveNotes,
      photoFileIds: row.photoFileIds as string[],
      instructBy: row.receivedAt && row.status === "RECEIVED" ? addDays(row.receivedAt, RETURN_RULES.instructionDays).toISOString() : null,
      instructedAt: row.instructedAt?.toISOString() ?? null,
      completedAt: row.completedAt?.toISOString() ?? null,
      lines: row.lines.map((line) => ({
        id: line.id,
        orderLineId: line.orderLineId,
        productName: line.orderLine.productName,
        productCode: line.orderLine.productCode,
        requestedQuantity: line.requestedQuantity,
        receivedQuantity: line.receivedQuantity,
        restockQuantity: line.restockQuantity,
        disposeQuantity: line.disposeQuantity,
        donateQuantity: line.donateQuantity,
      })),
    };
  }
}
