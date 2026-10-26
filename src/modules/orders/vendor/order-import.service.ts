import { Injectable } from "@nestjs/common";

import type { AuthPrincipal, RequestMeta } from "../../../common/auth/auth-principal";
import { AppException, Errors } from "../../../common/http/app-exception";
import { PrismaService } from "../../../database/prisma.service";
import type { Prisma } from "../../../generated/prisma/client";
import { AuditService } from "../../../infrastructure/audit/audit.service";
import { CsvFormatError, type CsvOrder, csvRecipient, groupOrderRows, type ImportResultView, ORDER_CSV_LIMITS, parseCsv, recipientSchema } from "../../../shared";
import { JobLockService } from "../../finance/jobs/job-lock.service";
import { vendorIdOf } from "../../onboarding/scope";
import { type TradingVendor, VendorStandingService } from "../../onboarding/vendor-standing.service";
import { OrderCreationService } from "../core/order-creation.service";

const DAY_MS = 24 * 60 * 60 * 1000;
const IMPORT_LOCK_MS = 10 * 60 * 1000;

type ImportResult = ImportResultView["results"][number];

function firstProblem(error: unknown): string {
  if (error instanceof AppException) {
    const fields = Object.entries(error.fieldErrors ?? {});
    if (fields.length > 0) {
      return fields.map(([field, messages]) => `${field.replace(/^deliveries\.0\./, "")}: ${messages[0]}`).join("; ");
    }
    return error.message;
  }
  return "This order couldn't be created. Try again.";
}

@Injectable()
export class OrderImportService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly creation: OrderCreationService,
    private readonly standing: VendorStandingService,
    private readonly audit: AuditService,
    private readonly locks: JobLockService,
  ) {}

  async history(principal: AuthPrincipal): Promise<ImportResultView[]> {
    const rows = await this.prisma.orderImportBatch.findMany({ where: { vendorId: vendorIdOf(principal) }, orderBy: { createdAt: "desc" }, take: 20 });
    return rows.map((row) => this.view(row));
  }

  async run(principal: AuthPrincipal, filename: string, csv: string, meta: RequestMeta): Promise<ImportResultView> {
    const vendor = await this.standing.assertCanTrade(principal);
    const result = await this.locks.runExclusive(`order-import:${vendor.vendorId}`, IMPORT_LOCK_MS, () => this.importFor(vendor, principal, filename, csv, meta));
    if (result === null) {
      throw Errors.invalidTransition("Another import is still running. Wait for it to finish, then try again.");
    }
    return result;
  }

  private async importFor(vendor: TradingVendor, principal: AuthPrincipal, filename: string, csv: string, meta: RequestMeta): Promise<ImportResultView> {
    if (Buffer.byteLength(csv, "utf8") > ORDER_CSV_LIMITS.maxBytes) {
      throw Errors.validation({ csv: [`Keep the file under ${ORDER_CSV_LIMITS.maxBytes / 1000} KB`] });
    }
    let grouped: ReturnType<typeof groupOrderRows>;
    try {
      const table = parseCsv(csv);
      if (table.length - 1 > ORDER_CSV_LIMITS.maxRows) {
        throw new CsvFormatError(`Keep the file to ${ORDER_CSV_LIMITS.maxRows} rows`);
      }
      grouped = groupOrderRows(table);
    } catch (error) {
      if (error instanceof CsvFormatError) {
        throw Errors.validation({ csv: [error.message] });
      }
      throw error;
    }
    if (grouped.orders.length === 0) {
      throw Errors.validation({ csv: [grouped.errors[0]?.message ?? "The file has no orders"] });
    }
    if (grouped.orders.length > ORDER_CSV_LIMITS.maxOrders) {
      throw Errors.validation({ csv: [`Keep each file to ${ORDER_CSV_LIMITS.maxOrders} orders`] });
    }
    const today = await this.prisma.order.count({ where: { vendorId: vendor.vendorId, source: "CSV", createdAt: { gt: new Date(Date.now() - DAY_MS) } } });
    if (today + grouped.orders.length > ORDER_CSV_LIMITS.dailyOrdersPerVendor) {
      throw Errors.forbidden(`Imports are limited to ${ORDER_CSV_LIMITS.dailyOrdersPerVendor} orders a day. You can import ${Math.max(0, ORDER_CSV_LIMITS.dailyOrdersPerVendor - today)} more today.`);
    }
    const products = await this.productIds(vendor.vendorId, grouped.orders);
    const results: ImportResult[] = [];
    for (const order of grouped.orders) {
      results.push(await this.createOne(vendor, principal, order, products));
    }
    const created = results.filter((result) => result.orderReference).length;
    const batch = await this.prisma.orderImportBatch.create({
      data: {
        vendorId: vendor.vendorId,
        filename: filename.slice(0, 200),
        ordersCreated: created,
        ordersFailed: results.length - created,
        results: results,
        rowErrors: grouped.errors.slice(0, 200) as unknown as Prisma.InputJsonValue,
        createdBy: principal.userId,
      },
    });
    await this.audit.record({
      actor: { userId: principal.userId, role: principal.role },
      action: "order.imported",
      resourceType: "order_import",
      resourceId: batch.id,
      vendorId: vendor.vendorId,
      after: { created, failed: results.length - created },
      meta,
    });
    return this.view(batch);
  }

  private async createOne(vendor: TradingVendor, principal: AuthPrincipal, order: CsvOrder, products: Map<string, string>): Promise<ImportResult> {
    const base = { reference: order.reference, rows: order.rows };
    const recipient = recipientSchema.safeParse(csvRecipient(order.recipient));
    if (!recipient.success) {
      const issue = recipient.error.issues[0]!;
      return { ...base, orderReference: null, message: `${issue.path.join(".") || "address"}: ${issue.message}` };
    }
    const unknown = order.lines.filter((line) => !products.has(line.productCode));
    if (unknown.length > 0) {
      return { ...base, orderReference: null, message: `Unknown product code ${unknown.map((line) => line.productCode).join(", ")}` };
    }
    const codes = order.lines.map((line) => line.productCode);
    if (new Set(codes).size !== codes.length) {
      return { ...base, orderReference: null, message: "Each product can only appear once per order" };
    }
    try {
      const [id] = await this.creation.create(vendor, { userId: principal.userId, role: principal.role, apiKeyId: null }, "CSV", [
        { externalReference: order.reference, recipient: recipient.data, lines: order.lines.map((line) => ({ productId: products.get(line.productCode)!, quantity: line.quantity })) },
      ]);
      const created = await this.prisma.order.findUniqueOrThrow({ where: { id: id! }, select: { reference: true } });
      return { ...base, orderReference: created.reference, message: null };
    } catch (error) {
      return { ...base, orderReference: null, message: firstProblem(error) };
    }
  }

  private async productIds(vendorId: string, orders: CsvOrder[]): Promise<Map<string, string>> {
    const codes = [...new Set(orders.flatMap((order) => order.lines.map((line) => line.productCode)))];
    const rows = await this.prisma.product.findMany({ where: { vendorId, code: { in: codes }, status: "ACTIVE" }, select: { id: true, code: true } });
    return new Map(rows.map((row) => [row.code, row.id]));
  }

  private view(row: { id: string; filename: string; createdAt: Date; ordersCreated: number; ordersFailed: number; results: unknown; rowErrors: unknown }): ImportResultView {
    return {
      id: row.id,
      filename: row.filename,
      createdAt: row.createdAt.toISOString(),
      ordersCreated: row.ordersCreated,
      ordersFailed: row.ordersFailed,
      results: row.results as ImportResultView["results"],
      rowErrors: row.rowErrors as ImportResultView["rowErrors"],
    };
  }
}
