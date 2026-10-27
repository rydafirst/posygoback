import { Injectable } from "@nestjs/common";

import type { RequestMeta } from "../../../common/auth/auth-principal";
import { AppException, Errors } from "../../../common/http/app-exception";
import { lockRow, PrismaService } from "../../../database/prisma.service";
import type { Prisma } from "../../../generated/prisma/client";
import { type AuditActor, AuditService } from "../../../infrastructure/audit/audit.service";
import { PartnerEmails } from "../partner-emails";
import { PartnerNotifierService } from "../partner-notifier.service";

const HOUR_MS = 60 * 60 * 1000;
const FULL_COUNT_LINES = 500;

export interface CountRequest {
  partnerId: string;
  countryCode: string;
  lines: number | "ALL";
  dueInHours: number;
  note: string | null;
  actor: AuditActor;
  reason: string;
  meta?: RequestMeta;
}

@Injectable()
export class StockCountFactoryService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly notifier: PartnerNotifierService,
    private readonly audit: AuditService,
  ) {}

  async request(request: CountRequest): Promise<string> {
    const count = await this.prisma.$transaction((tx) => this.create(tx, request));
    await this.notifier.notify(request.partnerId, (to, webUrl) => PartnerEmails.stockCountRequested(to, count.dueAt, webUrl));
    return count.id;
  }

  async requestIfStocked(request: CountRequest): Promise<string | null> {
    try {
      return await this.request(request);
    } catch (error) {
      if (error instanceof AppException) {
        return null;
      }
      throw error;
    }
  }

  private async create(tx: Prisma.TransactionClient, request: CountRequest): Promise<{ id: string; dueAt: Date }> {
    await lockRow(tx, "fulfilmentPartners", request.partnerId);
    const warehouse = await tx.warehouse.findFirst({ where: { partnerId: request.partnerId }, orderBy: { createdAt: "asc" }, select: { id: true } });
    if (!warehouse) {
      throw Errors.invalidTransition("This partner has no hub yet.");
    }
    if (await tx.stockCount.findFirst({ where: { warehouseId: warehouse.id, status: "REQUESTED" }, select: { id: true } })) {
      throw Errors.invalidTransition("A count is already waiting at this hub.");
    }
    const limit = request.lines === "ALL" ? FULL_COUNT_LINES : request.lines;
    const lots = await tx.$queryRaw<Array<{ id: string }>>`
      SELECT id FROM stock_lots WHERE warehouse_id = ${warehouse.id}::uuid AND quantity_available + quantity_reserved > 0 ORDER BY random() LIMIT ${limit}`;
    if (lots.length === 0) {
      throw Errors.invalidTransition("There's no stock at this hub to count.");
    }
    const count = await tx.stockCount.create({
      data: { partnerId: request.partnerId, warehouseId: warehouse.id, requestedBy: request.actor.userId, note: request.note, dueAt: new Date(Date.now() + request.dueInHours * HOUR_MS) },
    });
    await tx.stockCountLine.createMany({ data: lots.map((lot) => ({ countId: count.id, lotId: lot.id })) });
    await this.audit.record(
      {
        actor: request.actor,
        action: "partner.stock_count_requested",
        resourceType: "stock_count",
        resourceId: count.id,
        countryCode: request.countryCode,
        after: { lines: lots.length, reason: request.reason },
        meta: request.meta,
      },
      tx,
    );
    return count;
  }
}
