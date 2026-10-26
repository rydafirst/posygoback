import { Injectable } from "@nestjs/common";

import { addDays } from "../../../common/dates";
import { type DatabaseClient, PrismaService } from "../../../database/prisma.service";
import { type PartnerTier, partnerProgramme, type ScorecardView } from "../../../shared";
import { SHIPPED_ORDER_STATUSES } from "../ledger/partner-earnings.service";

const DAY_MS = 24 * 60 * 60 * 1000;
const RECENT_DAYS = 30;
const EVIDENCE_TARGET_PCT = 95;

interface ShippedRow {
  hours: number | null;
  photos: bigint;
  status: string;
}

function percent(part: number, whole: number): number | null {
  return whole === 0 ? null : Math.round((part / whole) * 1000) / 10;
}

function median(values: number[]): number | null {
  if (values.length === 0) {
    return null;
  }
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return Math.round((sorted.length % 2 ? sorted[middle]! : (sorted[middle - 1]! + sorted[middle]!) / 2) * 10) / 10;
}

const MYSTERY_BLOCK = "A test order failed recently";

@Injectable()
export class PartnerScorecardService {
  constructor(private readonly prisma: PrismaService) {}

  async scorecard(partnerId: string, client: DatabaseClient = this.prisma): Promise<ScorecardView> {
    const partner = await client.fulfilmentPartner.findUniqueOrThrow({
      where: { id: partnerId },
      select: { activatedAt: true, createdAt: true, tierLevel: true, country: { select: { config: true } } },
    });
    const since = partner.activatedAt ?? partner.createdAt;
    const daysActive = partner.activatedAt ? Math.floor((Date.now() - partner.activatedAt.getTime()) / DAY_MS) : 0;
    const recent = addDays(new Date(), -RECENT_DAYS);

    const shipped = await client.$queryRaw<ShippedRow[]>`
      SELECT EXTRACT(EPOCH FROM (o.handed_off_at - o.created_at)) / 3600 AS hours,
             (SELECT COUNT(*) FROM order_dispatch_photos p WHERE p.order_id = o.id) AS photos,
             o.status::text AS status
      FROM orders o
      JOIN warehouses w ON w.id = o.warehouse_id
      WHERE w.partner_id = ${partnerId}::uuid AND o.status::text = ANY(${[...SHIPPED_ORDER_STATUSES]}) AND o.created_at >= ${since}`;
    const withPhotos = shipped.filter((row) => row.photos > 0n);
    const cleanOrders = withPhotos.filter((row) => row.status !== "EXCEPTION" && row.status !== "RETURNED").length;

    const counts = await client.stockCount.findMany({
      where: { partnerId },
      select: { status: true, createdAt: true, resolvedAt: true, lines: { select: { expectedQuantity: true, countedQuantity: true } } },
    });
    const lines = counts.flatMap((count) => count.lines).filter((line) => line.expectedQuantity !== null && line.countedQuantity !== null);
    const matchedLines = lines.filter((line) => line.expectedQuantity === line.countedQuantity).length;
    const shortUnits = lines.reduce((total, line) => total + Math.max(0, line.expectedQuantity! - line.countedQuantity!), 0);
    const mystery = await client.mysteryOrder.groupBy({ by: ["outcome"], where: { partnerId }, _count: { _all: true } });
    const mysteryCount = (outcome: "PASSED" | "FAILED") => mystery.find((row) => row.outcome === outcome)?._count._all ?? 0;
    const received = await client.inboundLine.aggregate({ where: { inbound: { warehouse: { partnerId }, status: { in: ["RECEIVED", "DISCREPANCY"] } } }, _sum: { acceptedQuantity: true } });

    const evidencePct = percent(withPhotos.length, shipped.length);
    const unresolvedFlags = counts.some((count) => (count.status === "FLAGGED" || count.status === "MISSED") && (!count.resolvedAt || count.createdAt >= recent));
    const recentMysteryFail = (await client.mysteryOrder.count({ where: { partnerId, outcome: "FAILED", assessedAt: { gte: recent } } })) > 0;
    const view: ScorecardView = {
      periodDays: daysActive,
      daysActive,
      ordersShipped: shipped.length,
      cleanOrders,
      evidenceCompliancePct: evidencePct,
      medianDispatchHours: median(
        shipped
          .map((row) => row.hours)
          .filter((hours): hours is number => hours !== null)
          .map(Number),
      ),
      countLines: lines.length,
      countAccuracyPct: percent(matchedLines, lines.length),
      countsMatched: counts.filter((count) => count.status === "MATCHED").length,
      countsFlagged: counts.filter((count) => count.status === "FLAGGED").length,
      countsMissed: counts.filter((count) => count.status === "MISSED").length,
      mysteryPassed: mysteryCount("PASSED"),
      mysteryFailed: mysteryCount("FAILED"),
      shortUnits,
      lossRatePct: percent(shortUnits, received._sum.acceptedQuantity ?? 0),
      nextTier: null,
    };
    const next = partnerProgramme(partner.country.config as { partners?: unknown }).tiers.find((tier) => tier.level === partner.tierLevel + 1);
    if (next) {
      view.nextTier = this.progress(next, view, evidencePct, unresolvedFlags ? "A stock count was flagged or missed recently" : recentMysteryFail ? MYSTERY_BLOCK : null);
    }
    return view;
  }

  async forPartner(partnerId: string): Promise<ScorecardView> {
    const view = await this.scorecard(partnerId);
    const nextTier = view.nextTier && view.nextTier.blocked === MYSTERY_BLOCK ? { ...view.nextTier, blocked: "Some recent checks need a review first" } : view.nextTier;
    return { ...view, mysteryPassed: null, mysteryFailed: null, nextTier };
  }

  private progress(next: PartnerTier, view: ScorecardView, evidencePct: number | null, flagged: string | null): NonNullable<ScorecardView["nextTier"]> {
    const evidenceShort = view.ordersShipped > 0 && (evidencePct ?? 0) < EVIDENCE_TARGET_PCT ? `Dispatch photos on at least ${EVIDENCE_TARGET_PCT}% of orders` : null;
    return {
      level: next.level,
      name: next.name,
      ordersNeeded: Math.max(0, next.minCleanOrders - view.cleanOrders),
      countsNeeded: Math.max(0, next.minPassedCounts - view.countsMatched),
      daysNeeded: Math.max(0, next.minDaysActive - view.daysActive),
      blocked: flagged ?? evidenceShort,
    };
  }

  static readyForNextTier(view: ScorecardView): boolean {
    const next = view.nextTier;
    return next !== null && next.blocked === null && next.ordersNeeded === 0 && next.countsNeeded === 0 && next.daysNeeded === 0;
  }
}
