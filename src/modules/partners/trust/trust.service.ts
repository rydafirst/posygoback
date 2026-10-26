import { Injectable } from "@nestjs/common";

import { addDays } from "../../../common/dates";
import { PrismaService } from "../../../database/prisma.service";
import { partnerProgramme, type TrustView } from "../../../shared";
import { PartnerScorecardService } from "./partner-scorecard.service";

const LOOKBACK_DAYS = 90;
const MAX_SCORE = 100;

interface Penalty {
  label: string;
  points: number;
}

@Injectable()
export class TrustService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly scorecards: PartnerScorecardService,
  ) {}

  async evaluate(partnerId: string): Promise<TrustView> {
    const partner = await this.prisma.fulfilmentPartner.findUniqueOrThrow({ where: { id: partnerId }, select: { country: { select: { config: true } } } });
    const programme = partnerProgramme(partner.country.config as { partners?: unknown });
    const since = addDays(new Date(), -LOOKBACK_DAYS);
    const scorecard = await this.scorecards.scorecard(partnerId);
    const [unresolvedCounts, failedChecks, partnerClaims, noScans] = await Promise.all([
      this.prisma.stockCount.count({ where: { partnerId, status: { in: ["FLAGGED", "MISSED"] }, resolvedAt: null } }),
      this.prisma.mysteryOrder.count({ where: { partnerId, outcome: "FAILED", assessedAt: { gte: since } } }),
      this.prisma.custodyClaim.count({ where: { partnerId, status: "SETTLED", liability: "PARTNER", decidedAt: { gte: since } } }),
      this.prisma.custodyAlert.count({ where: { partnerId, kind: "NO_CARRIER_SCAN", status: "OPEN" } }),
    ]);
    const lossTooHigh = scorecard.lossRatePct !== null && scorecard.lossRatePct * 100 > programme.shrinkageAlertBps;
    const penalties: Penalty[] = [
      { label: "Orders sent without dispatch photos", points: scorecard.evidenceCompliancePct === null ? 0 : Math.round((MAX_SCORE - scorecard.evidenceCompliancePct) * 0.5) },
      { label: "Stock counts that didn't match", points: scorecard.countAccuracyPct === null ? 0 : Math.round((MAX_SCORE - scorecard.countAccuracyPct) * 0.3) },
      { label: "Flagged or missed counts not yet cleared", points: unresolvedCounts * 10 },
      { label: "Recent quality checks", points: failedChecks * 15 },
      { label: "Losses you were responsible for", points: partnerClaims * 10 },
      { label: "Stock lost overall", points: lossTooHigh ? 20 : 0 },
      { label: "Parcels the carrier never scanned", points: noScans * 5 },
    ];
    const factors = penalties.filter((penalty) => penalty.points > 0).map((penalty) => ({ label: penalty.label, points: -penalty.points }));
    const score = Math.max(0, Math.min(MAX_SCORE, MAX_SCORE + factors.reduce((total, factor) => total + factor.points, 0)));
    return { score, floor: programme.trustFloor, factors };
  }

  async promotable(partnerId: string): Promise<boolean> {
    const partner = await this.prisma.fulfilmentPartner.findUniqueOrThrow({ where: { id: partnerId }, select: { country: { select: { config: true } } } });
    const { score } = await this.evaluate(partnerId);
    return score >= partnerProgramme(partner.country.config as { partners?: unknown }).trustForPromotion;
  }
}
