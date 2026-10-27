import { Injectable } from "@nestjs/common";

import { addDays } from "../../../common/dates";
import { PrismaService } from "../../../database/prisma.service";
import { AuditService, SYSTEM_ACTOR } from "../../../infrastructure/audit/audit.service";
import { partnerProgramme } from "../../../shared";
import { CustodyAlertsService } from "../custody/custody-alerts.service";
import { CustodyEmails } from "../custody/custody-emails";
import { PartnerNotifierService } from "../partner-notifier.service";
import { PartnerScorecardService } from "../trust/partner-scorecard.service";
import { StockCountFactoryService } from "../trust/stock-count-factory.service";
import { TrustService } from "../trust/trust.service";

export interface CustodySummary {
  cycleCounts: number;
  noScanAlerts: number;
  shrinkageAlerts: number;
  trustSuspensions: number;
}

const CYCLE_LINES = 10;
const CYCLE_DUE_HOURS = 48;
const FULL_COUNT_DUE_HOURS = 72;

@Injectable()
export class CustodyUpkeepService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly alerts: CustodyAlertsService,
    private readonly counts: StockCountFactoryService,
    private readonly scorecards: PartnerScorecardService,
    private readonly trust: TrustService,
    private readonly notifier: PartnerNotifierService,
    private readonly audit: AuditService,
  ) {}

  async run(): Promise<CustodySummary> {
    const noScanAlerts = await this.alerts.scanMissingCarrierScans();
    const partners = await this.prisma.fulfilmentPartner.findMany({ where: { status: "ACTIVE" }, select: { id: true, countryCode: true, country: { select: { config: true } } } });
    const summary: CustodySummary = { cycleCounts: 0, noScanAlerts, shrinkageAlerts: 0, trustSuspensions: 0 };
    for (const partner of partners) {
      const programme = partnerProgramme(partner.country.config as { partners?: unknown });
      summary.shrinkageAlerts += await this.watchShrinkage(partner.id, partner.countryCode, programme.shrinkageAlertBps);
      if (await this.enforceTrust(partner.id, partner.countryCode)) {
        summary.trustSuspensions += 1;
        continue;
      }
      if (programme.cycleCountDays > 0 && (await this.cycleCountDue(partner.id, programme.cycleCountDays))) {
        const requested = await this.counts.requestIfStocked({
          partnerId: partner.id,
          countryCode: partner.countryCode,
          lines: CYCLE_LINES,
          dueInHours: CYCLE_DUE_HOURS,
          note: "Routine count",
          actor: SYSTEM_ACTOR,
          reason: "cycle",
        });
        summary.cycleCounts += requested ? 1 : 0;
      }
    }
    return summary;
  }

  private async cycleCountDue(partnerId: string, days: number): Promise<boolean> {
    const recent = await this.prisma.stockCount.count({ where: { partnerId, createdAt: { gte: addDays(new Date(), -days) } } });
    return recent === 0;
  }

  private async watchShrinkage(partnerId: string, countryCode: string, thresholdBps: number): Promise<number> {
    const { lossRatePct } = await this.scorecards.scorecard(partnerId);
    if (lossRatePct === null || lossRatePct * 100 <= thresholdBps) {
      return 0;
    }
    return this.alerts.raise([
      {
        kind: "SHRINKAGE",
        countryCode,
        partnerId,
        warehouseId: null,
        subjectType: "fulfilment_partner",
        subjectId: partnerId,
        message: `This hub has lost ${lossRatePct}% of the stock it received, above the ${thresholdBps / 100}% limit.`,
      },
    ]);
  }

  private async enforceTrust(partnerId: string, countryCode: string): Promise<boolean> {
    const trust = await this.trust.evaluate(partnerId);
    if (trust.score >= trust.floor) {
      return false;
    }
    const reason = `Trust score ${trust.score} fell below ${trust.floor}`;
    const moved = await this.prisma.$transaction(async (tx) => {
      const updated = await tx.fulfilmentPartner.updateMany({ where: { id: partnerId, status: "ACTIVE" }, data: { status: "SUSPENDED", statusReason: reason } });
      if (updated.count === 0) {
        return false;
      }
      await this.alerts.raise(
        [{ kind: "TRUST_LOW", countryCode, partnerId, warehouseId: null, subjectType: "fulfilment_partner", subjectId: partnerId, message: `${reason}. The hub has been paused.` }],
        tx,
      );
      await this.audit.record(
        {
          actor: SYSTEM_ACTOR,
          action: "partner.suspended_trust",
          resourceType: "fulfilment_partner",
          resourceId: partnerId,
          countryCode,
          before: { status: "ACTIVE" },
          after: { status: "SUSPENDED", score: trust.score },
        },
        tx,
      );
      return true;
    });
    if (moved) {
      await this.counts.requestIfStocked({ partnerId, countryCode, lines: "ALL", dueInHours: FULL_COUNT_DUE_HOURS, note: "Full count after the hub was paused", actor: SYSTEM_ACTOR, reason: "trust" });
      await this.notifier.notify(partnerId, (to, webUrl) => CustodyEmails.trustSuspended(to, trust.score, webUrl));
    }
    return moved;
  }
}
