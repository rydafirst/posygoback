import { Injectable } from "@nestjs/common";

import type { AuthPrincipal, RequestMeta } from "../../../common/auth/auth-principal";
import { Errors } from "../../../common/http/app-exception";
import { lockRow, PrismaService } from "../../../database/prisma.service";
import type { Prisma } from "../../../generated/prisma/client";
import { AuditService, SYSTEM_ACTOR } from "../../../infrastructure/audit/audit.service";
import type { RequestStockCountInput, StockCountView, SubmitStockCountInput } from "../../../shared";
import { FilesService } from "../../files/files.service";
import { warehouseScope } from "../../stock/scope";
import { actorOf, adminPartnerScope, AdminPartnersService } from "../admin/admin-partners.service";
import { ClaimsService } from "../custody/claims.service";
import { CustodyAlertsService } from "../custody/custody-alerts.service";
import { PartnerEmails } from "../partner-emails";
import { PartnerNotifierService } from "../partner-notifier.service";
import { StockCountFactoryService } from "./stock-count-factory.service";

const COUNT_INCLUDE = {
  partner: { select: { legalName: true } },
  warehouse: { select: { name: true } },
  _count: { select: { custodyClaims: true } },
  lines: { include: { lot: { select: { code: true, product: { select: { code: true, name: true } }, location: { select: { code: true } } } } }, orderBy: { id: "asc" } },
} satisfies Prisma.StockCountInclude;

type CountRow = Prisma.StockCountGetPayload<{ include: typeof COUNT_INCLUDE }>;

function toView(row: CountRow, revealExpected: boolean): StockCountView {
  return {
    id: row.id,
    partnerId: row.partnerId,
    legalName: row.partner.legalName,
    warehouseName: row.warehouse.name,
    status: row.status,
    note: row.note,
    dueAt: row.dueAt.toISOString(),
    videoFileId: revealExpected ? row.videoFileId : null,
    submittedAt: row.submittedAt?.toISOString() ?? null,
    mismatchedLines: revealExpected ? row.mismatchedLines : 0,
    resolvedAt: row.resolvedAt?.toISOString() ?? null,
    resolutionNote: revealExpected ? row.resolutionNote : null,
    claimsOpened: revealExpected ? row._count.custodyClaims : 0,
    createdAt: row.createdAt.toISOString(),
    lines: row.lines.map((line) => ({
      id: line.id,
      lotCode: line.lot.code,
      productCode: line.lot.product.code,
      productName: line.lot.product.name,
      location: line.lot.location?.code ?? null,
      expectedQuantity: revealExpected ? line.expectedQuantity : null,
      countedQuantity: line.countedQuantity,
    })),
  };
}

@Injectable()
export class StockCountsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly admin: AdminPartnersService,
    private readonly files: FilesService,
    private readonly factory: StockCountFactoryService,
    private readonly claims: ClaimsService,
    private readonly alerts: CustodyAlertsService,
    private readonly notifier: PartnerNotifierService,
    private readonly audit: AuditService,
  ) {}

  async request(principal: AuthPrincipal, partnerId: string, input: RequestStockCountInput, meta: RequestMeta): Promise<StockCountView> {
    const partner = await this.admin.scoped(principal, partnerId);
    if (partner.status !== "ACTIVE") {
      throw Errors.invalidTransition("Stock counts are for active hubs.");
    }
    const countId = await this.factory.request({
      partnerId,
      countryCode: partner.countryCode,
      lines: input.lines,
      dueInHours: input.dueInHours,
      note: input.note ?? null,
      actor: actorOf(principal),
      reason: "requested",
      meta,
    });
    return this.adminView(principal, countId);
  }

  async listForAdmin(principal: AuthPrincipal, filters: { partnerId?: string; status?: StockCountView["status"] }): Promise<StockCountView[]> {
    const rows = await this.prisma.stockCount.findMany({
      where: { partner: adminPartnerScope(principal), ...(filters.partnerId ? { partnerId: filters.partnerId } : {}), ...(filters.status ? { status: filters.status } : {}) },
      include: COUNT_INCLUDE,
      orderBy: { createdAt: "desc" },
      take: 100,
    });
    return rows.map((row) => toView(row, true));
  }

  async adminView(principal: AuthPrincipal, countId: string): Promise<StockCountView> {
    const row = await this.prisma.stockCount.findFirst({ where: { id: countId, partner: adminPartnerScope(principal) }, include: COUNT_INCLUDE });
    if (!row) {
      throw Errors.notFound();
    }
    return toView(row, true);
  }

  async listForHub(principal: AuthPrincipal): Promise<StockCountView[]> {
    const rows = await this.prisma.stockCount.findMany({ where: { warehouse: warehouseScope(principal) }, include: COUNT_INCLUDE, orderBy: { createdAt: "desc" }, take: 50 });
    return rows.map((row) => toView(row, false));
  }

  async submit(principal: AuthPrincipal, countId: string, input: SubmitStockCountInput, meta: RequestMeta): Promise<StockCountView> {
    const owned = await this.prisma.stockCount.findFirst({ where: { id: countId, warehouse: warehouseScope(principal) }, select: { id: true } });
    if (!owned) {
      throw Errors.notFound();
    }
    const statuses = await this.files.uploadedBy(principal.userId, [input.videoFileId], "STOCK_COUNT");
    if (statuses.get(input.videoFileId) !== "VERIFIED") {
      throw Errors.validation({ videoFileId: ["Upload the video of your count and wait for it to be checked"] });
    }
    if (await this.prisma.stockCount.count({ where: { videoFileId: input.videoFileId } })) {
      throw Errors.validation({ videoFileId: ["Film a new video for each count"] });
    }
    await this.prisma.$transaction(async (tx) => {
      const count = await tx.stockCount.findUniqueOrThrow({
        where: { id: countId },
        include: { lines: { include: { lot: { select: { quantityAvailable: true, quantityReserved: true } } } }, partner: { select: { countryCode: true } } },
      });
      if (count.status !== "REQUESTED") {
        throw Errors.invalidTransition("This count has already been sent.");
      }
      const counted = new Map(input.lines.map((line) => [line.lineId, line.countedQuantity]));
      if (counted.size !== count.lines.length || count.lines.some((line) => !counted.has(line.id))) {
        throw Errors.validation({ lines: ["Count every item on the list"] });
      }
      let mismatched = 0;
      for (const line of count.lines) {
        await lockRow(tx, "stockLots", line.lotId);
        const lot = await tx.stockLot.findUniqueOrThrow({ where: { id: line.lotId }, select: { quantityAvailable: true, quantityReserved: true } });
        const expected = lot.quantityAvailable + lot.quantityReserved;
        const countedQuantity = counted.get(line.id)!;
        mismatched += expected === countedQuantity ? 0 : 1;
        await tx.stockCountLine.update({ where: { id: line.id }, data: { expectedQuantity: expected, countedQuantity } });
      }
      const status = mismatched === 0 ? "MATCHED" : "FLAGGED";
      const updated = await tx.stockCount.updateMany({
        where: { id: countId, status: "REQUESTED" },
        data: { status, mismatchedLines: mismatched, videoFileId: input.videoFileId, submittedBy: principal.userId, submittedAt: new Date() },
      });
      if (updated.count === 0) {
        throw Errors.invalidTransition("This count has already been sent.");
      }
      if (status === "FLAGGED") {
        await this.alerts.raise(
          [
            {
              kind: "COUNT_SHORTFALL",
              countryCode: count.partner.countryCode,
              partnerId: count.partnerId,
              warehouseId: count.warehouseId,
              subjectType: "stock_count",
              subjectId: countId,
              message: `A stock count at this hub didn't match on ${mismatched} ${mismatched === 1 ? "item" : "items"}. Watch the video and decide whether to open claims.`,
            },
          ],
          tx,
        );
      }
      await this.audit.record(
        {
          actor: actorOf(principal),
          action: `partner.stock_count_${status.toLowerCase()}`,
          resourceType: "stock_count",
          resourceId: countId,
          countryCode: count.partner.countryCode,
          after: { mismatched },
          meta,
        },
        tx,
      );
    });
    const row = await this.prisma.stockCount.findUniqueOrThrow({ where: { id: countId }, include: COUNT_INCLUDE });
    return toView(row, false);
  }

  async resolve(principal: AuthPrincipal, countId: string, input: { note: string; openClaims: boolean }, meta: RequestMeta): Promise<StockCountView> {
    const count = await this.adminView(principal, countId);
    if (count.status !== "FLAGGED" && count.status !== "MISSED") {
      throw Errors.invalidTransition("Only flagged or missed counts need resolving.");
    }
    const claimIds = await this.prisma.$transaction(async (tx) => {
      await lockRow(tx, "stockCounts", countId);
      const resolved = await tx.stockCount.updateMany({ where: { id: countId, resolvedAt: null }, data: { resolvedBy: principal.userId, resolvedAt: new Date(), resolutionNote: input.note } });
      if (resolved.count === 0) {
        throw Errors.invalidTransition("This count has already been resolved.");
      }
      const opened = input.openClaims && count.status === "FLAGGED" ? await this.openShortfallClaims(tx, principal, countId) : [];
      await tx.custodyAlert.updateMany({
        where: { kind: "COUNT_SHORTFALL", subjectId: countId, status: "OPEN" },
        data: { status: "RESOLVED", resolvedBy: principal.userId, resolvedAt: new Date(), resolutionNote: input.note },
      });
      await this.audit.record(
        { actor: actorOf(principal), action: "partner.stock_count_resolved", resourceType: "stock_count", resourceId: countId, after: { note: input.note, claims: opened.length }, meta },
        tx,
      );
      return opened;
    });
    await this.claims.announceOpened(claimIds);
    return this.adminView(principal, countId);
  }

  private async openShortfallClaims(tx: Prisma.TransactionClient, principal: AuthPrincipal, countId: string): Promise<string[]> {
    const count = await tx.stockCount.findUniqueOrThrow({
      where: { id: countId },
      select: {
        partnerId: true,
        warehouseId: true,
        partner: { select: { countryCode: true } },
        lines: {
          select: { expectedQuantity: true, countedQuantity: true, lot: { select: { id: true, vendorId: true, product: { select: { name: true, declaredValueMinor: true, currency: true } } } } },
        },
      },
    });
    const opened: string[] = [];
    for (const line of count.lines) {
      const missing = (line.expectedQuantity ?? 0) - (line.countedQuantity ?? 0);
      if (missing <= 0) {
        continue;
      }
      const claimId = await this.claims.open(tx, {
        kind: "SHORTAGE",
        source: "STOCK_COUNT",
        vendorId: line.lot.vendorId,
        warehouseId: count.warehouseId,
        partnerId: count.partnerId,
        countryCode: count.partner.countryCode,
        lotId: line.lot.id,
        orderId: null,
        stockCountId: countId,
        quantity: missing,
        unitValueMinor: line.lot.product.declaredValueMinor,
        currency: line.lot.product.currency,
        description: `A stock count found ${missing} fewer ${line.lot.product.name} than our records show.`,
        createdBy: principal.userId,
      });
      opened.push(claimId);
    }
    return opened;
  }

  async markMissed(now: Date = new Date()): Promise<number> {
    const overdue = await this.prisma.stockCount.findMany({ where: { status: "REQUESTED", dueAt: { lt: now } }, select: { id: true, partnerId: true, dueAt: true } });
    for (const count of overdue) {
      const missed = await this.prisma.stockCount.updateMany({ where: { id: count.id, status: "REQUESTED" }, data: { status: "MISSED" } });
      if (missed.count > 0) {
        await this.audit.record({ actor: SYSTEM_ACTOR, action: "partner.stock_count_missed", resourceType: "stock_count", resourceId: count.id });
        await this.notifier.notify(count.partnerId, (to, webUrl) => PartnerEmails.stockCountMissed(to, count.dueAt, webUrl));
      }
    }
    return overdue.length;
  }
}
