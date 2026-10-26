import { Injectable } from "@nestjs/common";

import type { AuthPrincipal, RequestMeta } from "../../common/auth/auth-principal";
import { Errors } from "../../common/http/app-exception";
import { PrismaService } from "../../database/prisma.service";
import { AuditService } from "../../infrastructure/audit/audit.service";
import { currencyDefinition, EXPORT_LIMITS, type ExportKind, type ExportRange } from "../../shared";
import { vendorIdOf } from "../onboarding/scope";
import { type CsvCell, minorToDecimal, toCsv } from "./csv";

const DAY_MS = 24 * 60 * 60 * 1000;

export interface CsvFile {
  filename: string;
  body: string;
}

function window(range: ExportRange) {
  return { gte: new Date(`${range.from}T00:00:00.000Z`), lt: new Date(Date.parse(`${range.to}T00:00:00.000Z`) + DAY_MS) };
}

@Injectable()
export class VendorExportsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async orders(principal: AuthPrincipal, range: ExportRange, meta: RequestMeta): Promise<CsvFile> {
    const where = { vendorId: vendorIdOf(principal), createdAt: window(range) };
    this.assertSize(await this.prisma.order.count({ where }));
    const rows = await this.prisma.order.findMany({ where, include: { lines: { select: { quantity: true } }, warehouse: { select: { name: true } } }, orderBy: { createdAt: "asc" } });
    const body = toCsv(
      [
        "created_at",
        "reference",
        "your_reference",
        "source",
        "status",
        "warehouse",
        "recipient",
        "city",
        "destination",
        "units",
        "currency",
        "fulfilment_fee",
        "shipping_charge",
        "refunded",
        "carrier",
        "tracking_number",
        "handed_off_at",
        "delivered_at",
      ],
      rows.map((row) => {
        const digits = currencyDefinition(row.currency).minorUnits;
        return [
          row.createdAt.toISOString(),
          row.reference,
          row.externalReference,
          row.source,
          row.status,
          row.warehouse.name,
          row.recipientName,
          row.recipientCity,
          row.destinationCountryCode,
          row.lines.reduce((total, line) => total + line.quantity, 0),
          row.currency,
          minorToDecimal(row.fulfilmentFeeMinor, digits),
          minorToDecimal(row.shippingChargeMinor, digits),
          minorToDecimal(row.refundedMinor, digits),
          row.carrier,
          row.trackingNumber,
          row.handedOffAt?.toISOString(),
          row.deliveredAt?.toISOString(),
        ] satisfies CsvCell[];
      }),
    );
    return this.done(principal, "orders", range, rows.length, body, meta);
  }

  async ledger(principal: AuthPrincipal, range: ExportRange, meta: RequestMeta): Promise<CsvFile> {
    const where = { vendorId: vendorIdOf(principal), createdAt: window(range) };
    this.assertSize(await this.prisma.ledgerEntry.count({ where }));
    const rows = await this.prisma.ledgerEntry.findMany({ where, include: { wallet: { select: { currency: true } } }, orderBy: [{ createdAt: "asc" }, { id: "asc" }] });
    const body = toCsv(
      ["created_at", "type", "description", "currency", "amount", "balance_after", "reference_type", "reference_id"],
      rows.map((row) => {
        const digits = currencyDefinition(row.wallet.currency).minorUnits;
        return [
          row.createdAt.toISOString(),
          row.type,
          row.description,
          row.wallet.currency,
          minorToDecimal(row.amountMinor, digits),
          minorToDecimal(row.balanceAfterMinor, digits),
          row.referenceType,
          row.referenceId,
        ] satisfies CsvCell[];
      }),
    );
    return this.done(principal, "ledger", range, rows.length, body, meta);
  }

  async inventory(principal: AuthPrincipal, meta: RequestMeta): Promise<CsvFile> {
    const where = { vendorId: vendorIdOf(principal), OR: [{ quantityAvailable: { gt: 0 } }, { quantityReserved: { gt: 0 } }] };
    this.assertSize(await this.prisma.stockLot.count({ where }));
    const rows = await this.prisma.stockLot.findMany({
      where,
      include: { product: { select: { code: true, name: true } }, warehouse: { select: { name: true } } },
      orderBy: [{ product: { code: "asc" } }, { receivedAt: "asc" }],
    });
    const body = toCsv(
      ["product_code", "product_name", "lot", "condition", "warehouse", "available", "reserved", "received_at"],
      rows.map(
        (row) => [row.product.code, row.product.name, row.code, row.condition, row.warehouse.name, row.quantityAvailable, row.quantityReserved, row.receivedAt.toISOString()] satisfies CsvCell[],
      ),
    );
    const today = new Date().toISOString().slice(0, 10);
    return this.done(principal, "inventory", { from: today, to: today }, rows.length, body, meta);
  }

  private assertSize(count: number): void {
    if (count > EXPORT_LIMITS.maxRows) {
      throw Errors.invalidTransition(`That's ${count.toLocaleString("en-GB")} rows, more than the ${EXPORT_LIMITS.maxRows.toLocaleString("en-GB")} we can put in one file. Choose fewer dates.`);
    }
  }

  private async done(principal: AuthPrincipal, kind: ExportKind, range: ExportRange, rows: number, body: string, meta: RequestMeta): Promise<CsvFile> {
    await this.audit.record({
      actor: { userId: principal.userId, role: principal.role },
      action: `export.${kind}`,
      resourceType: "vendor",
      resourceId: principal.vendorId,
      vendorId: principal.vendorId,
      after: { ...range, rows },
      meta,
    });
    return { filename: kind === "inventory" ? `inventory-${range.to}.csv` : `${kind}-${range.from}-to-${range.to}.csv`, body };
  }
}
