import { Injectable } from "@nestjs/common";

import { addDays, isoDate, startOfUtcDay } from "../../../common/dates";
import { Errors } from "../../../common/http/app-exception";
import { PrismaService } from "../../../database/prisma.service";
import type { PartnerEntryType, PartnerStatementView, StatementRange } from "../../../shared";
import { SHIPPED_ORDER_STATUSES } from "./partner-earnings.service";
import { PartnerLedgerService } from "./partner-ledger.service";

const EARNING_TYPES: readonly PartnerEntryType[] = ["RECEIVING", "FULFILMENT", "STORAGE_SHARE", "HOLDBACK"];
const MAX_DAYS = 366;
const MAX_ENTRIES = 500;

@Injectable()
export class PartnerStatementService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly ledger: PartnerLedgerService,
  ) {}

  async statement(partnerId: string, range: StatementRange): Promise<PartnerStatementView> {
    const to = range.to ? new Date(`${range.to}T00:00:00Z`) : startOfUtcDay(new Date());
    const from = range.from ? new Date(`${range.from}T00:00:00Z`) : addDays(to, -30);
    if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime()) || addDays(from, MAX_DAYS) < to) {
      throw Errors.validation({ from: ["Choose a range of a year or less"] });
    }
    const partner = await this.prisma.fulfilmentPartner.findUniqueOrThrow({ where: { id: partnerId }, select: { country: { select: { currency: true } } } });
    const window = { partnerId, createdAt: { gte: from, lt: addDays(to, 1) } };
    const [balances, entries, totals] = await Promise.all([
      this.ledger.balances(this.prisma, partnerId),
      this.prisma.partnerLedgerEntry.findMany({ where: window, orderBy: [{ createdAt: "desc" }, { id: "desc" }], take: MAX_ENTRIES }),
      this.prisma.partnerLedgerEntry.groupBy({ by: ["type"], where: { ...window, amountMinor: { gt: 0 } }, _sum: { amountMinor: true } }),
    ]);
    const payouts = await this.prisma.partnerLedgerEntry.aggregate({ where: { ...window, type: "PAYOUT" }, _sum: { amountMinor: true } });
    const awaiting = await this.prisma.order.findMany({
      where: { warehouse: { partnerId }, status: { in: [...SHIPPED_ORDER_STATUSES] }, dispatchPhotos: { none: {} }, createdAt: { gte: addDays(new Date(), -90) } },
      select: { id: true, reference: true, handedOffAt: true },
      orderBy: { createdAt: "desc" },
      take: 50,
    });
    return {
      currency: partner.country.currency,
      ...balances,
      from: isoDate(from),
      to: isoDate(to),
      earnedMinor: totals.filter((row) => EARNING_TYPES.includes(row.type)).reduce((sum, row) => sum + Number(row._sum.amountMinor ?? 0n), 0),
      paidMinor: -Number(payouts._sum.amountMinor ?? 0n),
      awaitingEvidence: awaiting.map((order) => ({ orderId: order.id, reference: order.reference, handedOffAt: order.handedOffAt?.toISOString() ?? null })),
      entries: entries.map((entry) => ({
        id: entry.id,
        type: entry.type,
        bucket: entry.bucket,
        amountMinor: Number(entry.amountMinor),
        description: entry.description,
        releaseOn: entry.releaseOn ? isoDate(entry.releaseOn) : null,
        createdAt: entry.createdAt.toISOString(),
      })),
    };
  }
}
