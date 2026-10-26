import { Injectable, Logger } from "@nestjs/common";

import { addDays, isoDate, startOfUtcDay } from "../../../common/dates";
import { PrismaService } from "../../../database/prisma.service";
import { AuditService, SYSTEM_ACTOR } from "../../../infrastructure/audit/audit.service";
import { CLOSED_PARTNER_STATUSES, partnerProgramme, type PartnerStatus } from "../../../shared";
import { FilesService } from "../../files/files.service";
import { PartnerFinanceService, retryCutoff } from "../admin/partner-finance.service";
import { PartnerScorecardService } from "../trust/partner-scorecard.service";
import { StockCountsService } from "../trust/stock-counts.service";
import { TrustService } from "../trust/trust.service";
import { PartnerLedgerService } from "../ledger/partner-ledger.service";
import { PartnerEmails } from "../partner-emails";
import { PartnerNotifierService } from "../partner-notifier.service";

export interface UpkeepSummary {
  holdbacksReleased: number;
  remindersSent: number;
  policiesExpired: number;
  partnersSuspended: number;
  countsMissed: number;
  tiersRaised: number;
  proofsPurged: number;
  payoutsRetried: number;
}

interface DueHoldback {
  id: string;
  partner_id: string;
  amount_minor: bigint;
}

const MANUAL_TIER_HOLD_DAYS = 90;

@Injectable()
export class PartnerUpkeepService {
  private readonly logger = new Logger(PartnerUpkeepService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly ledger: PartnerLedgerService,
    private readonly notifier: PartnerNotifierService,
    private readonly counts: StockCountsService,
    private readonly scorecards: PartnerScorecardService,
    private readonly trust: TrustService,
    private readonly finance: PartnerFinanceService,
    private readonly files: FilesService,
    private readonly audit: AuditService,
  ) {}

  async run(today: Date = startOfUtcDay(new Date())): Promise<UpkeepSummary> {
    const holdbacksReleased = await this.releaseHoldbacks(today);
    const insurance = await this.sweepInsurance(today);
    const countsMissed = await this.counts.markMissed();
    const tiersRaised = await this.raiseTiers();
    const proofsPurged = await this.purgeProofs(today);
    const payoutsRetried = await this.retryPayouts();
    return { holdbacksReleased, ...insurance, countsMissed, tiersRaised, proofsPurged, payoutsRetried };
  }

  async raiseTiers(): Promise<number> {
    const partners = await this.prisma.fulfilmentPartner.findMany({
      where: { status: "ACTIVE", OR: [{ tierSetManuallyAt: null }, { tierSetManuallyAt: { lt: addDays(new Date(), -MANUAL_TIER_HOLD_DAYS) } }] },
      select: { id: true, tierLevel: true },
    });
    let raised = 0;
    for (const partner of partners) {
      const scorecard = await this.scorecards.scorecard(partner.id);
      const next = scorecard.nextTier;
      if (!next || !PartnerScorecardService.readyForNextTier(scorecard) || !(await this.trust.promotable(partner.id))) {
        continue;
      }
      const moved = await this.prisma.fulfilmentPartner.updateMany({ where: { id: partner.id, tierLevel: partner.tierLevel, status: "ACTIVE" }, data: { tierLevel: next.level } });
      if (moved.count > 0) {
        raised += 1;
        await this.audit.record({
          actor: SYSTEM_ACTOR,
          action: "partner.tier_raised",
          resourceType: "fulfilment_partner",
          resourceId: partner.id,
          before: { tierLevel: partner.tierLevel },
          after: { tierLevel: next.level },
        });
        await this.notifier.notify(partner.id, (to) => PartnerEmails.tierRaised(to, next.name));
      }
    }
    return raised;
  }

  async purgeProofs(today: Date): Promise<number> {
    const countries = await this.prisma.country.findMany({ select: { code: true, config: true } });
    let purged = 0;
    for (const country of countries) {
      const cutoff = addDays(today, -partnerProgramme(country.config as { partners?: unknown }).proofOfAddressRetentionDays);
      const closed = { countryCode: country.code, status: { in: ["REJECTED", "TERMINATED"] as PartnerStatus[] } };
      const checks = await this.prisma.partnerCheck.findMany({
        where: {
          filesPurgedAt: null,
          partner: { countryCode: country.code },
          OR: [
            { kind: "PROOF_OF_ADDRESS", status: { in: ["ACCEPTED", "REJECTED"] }, reviewedAt: { lte: cutoff } },
            { kind: { in: ["PROOF_OF_ADDRESS", "STORAGE_SPACE"] }, partner: closed, submittedAt: { lte: cutoff } },
          ],
        },
        select: { id: true, fileIds: true },
        orderBy: { submittedAt: "asc" },
        take: 1000,
      });
      for (const check of checks) {
        await this.files.purge(check.fileIds as string[]);
        await this.prisma.partnerCheck.update({ where: { id: check.id }, data: { filesPurgedAt: new Date() } });
        purged += 1;
      }
    }
    return purged;
  }

  async retryPayouts(): Promise<number> {
    const stuck = await this.prisma.partnerPayout.findMany({
      where: { status: "PROCESSING", decidedAt: { lt: new Date(Date.now() - 10 * 60 * 1000), gte: retryCutoff() } },
      select: { id: true },
      take: 100,
    });
    for (const payout of stuck) {
      await this.finance.send(payout.id);
    }
    return stuck.length;
  }

  async releaseHoldbacks(today: Date): Promise<number> {
    const due = await this.prisma.$queryRaw<DueHoldback[]>`
      SELECT held.id, held.partner_id, held.amount_minor
      FROM partner_ledger_entries held
      JOIN fulfilment_partners partner ON partner.id = held.partner_id
      WHERE held.bucket = 'HELD' AND held.amount_minor > 0 AND held.release_on <= ${today}::date
        AND partner.status NOT IN ('SUSPENDED', 'OFFBOARDING', 'TERMINATED')
        AND NOT EXISTS (SELECT 1 FROM stock_counts count WHERE count.partner_id = held.partner_id AND count.status IN ('FLAGGED', 'MISSED') AND count.resolved_at IS NULL)
        AND NOT EXISTS (SELECT 1 FROM custody_claims claim WHERE claim.partner_id = held.partner_id AND claim.status IN ('OPEN', 'ASSESSED'))
        AND NOT EXISTS (SELECT 1 FROM mystery_orders mystery WHERE mystery.partner_id = held.partner_id AND mystery.outcome = 'FAILED' AND mystery.assessed_at > now() - interval '90 days')
        AND NOT EXISTS (
          SELECT 1 FROM partner_ledger_entries released
          WHERE released.partner_id = held.partner_id AND released.idempotency_key = 'release:' || held.id::text
        )
      ORDER BY held.release_on, held.id
      LIMIT 5000`;
    let released = 0;
    for (const entry of due) {
      try {
        await this.prisma.$transaction(async (tx) => {
          const amount = Number(entry.amount_minor);
          const common = { type: "HOLDBACK_RELEASE" as const, description: "Holdback released", reference: { type: "partner_ledger_entry", id: entry.id } };
          const result = await this.ledger.post(tx, entry.partner_id, { ...common, bucket: "AVAILABLE", amountMinor: amount, idempotencyKey: `release:${entry.id}` });
          if (!result.duplicate) {
            await this.ledger.post(tx, entry.partner_id, { ...common, bucket: "HELD", amountMinor: -amount, idempotencyKey: `release:${entry.id}:held` });
            released += 1;
          }
        });
      } catch (error) {
        this.logger.error(`Holdback release failed for ${entry.id}: ${String(error)}`);
      }
    }
    return released;
  }

  async sweepInsurance(today: Date): Promise<Pick<UpkeepSummary, "remindersSent" | "policiesExpired" | "partnersSuspended">> {
    const summary = { remindersSent: 0, policiesExpired: 0, partnersSuspended: 0 };
    const open = { status: "VERIFIED" as const, partner: { status: { notIn: [...CLOSED_PARTNER_STATUSES] } } };
    for (const [days, field] of [
      [30, "reminded30At"],
      [7, "reminded7At"],
    ] as const) {
      const expiring = await this.prisma.partnerInsurancePolicy.findMany({ where: { ...open, expiresOn: { gt: today, lte: addDays(today, days) }, [field]: null }, take: 1000 });
      for (const policy of expiring) {
        if (await this.renewed(policy.partnerId, policy.id, policy.expiresOn)) {
          continue;
        }
        const claimed = await this.prisma.partnerInsurancePolicy.updateMany({ where: { id: policy.id, [field]: null }, data: { [field]: new Date() } });
        if (claimed.count > 0) {
          await this.notifier.notify(policy.partnerId, (to) => PartnerEmails.insuranceExpiring(to, days, isoDate(policy.expiresOn)));
          summary.remindersSent += 1;
        }
      }
    }
    const expired = await this.prisma.partnerInsurancePolicy.findMany({ where: { status: "VERIFIED", expiresOn: { lte: today } }, select: { id: true, partnerId: true }, take: 1000 });
    for (const policy of expired) {
      await this.prisma.partnerInsurancePolicy.updateMany({ where: { id: policy.id, status: "VERIFIED" }, data: { status: "EXPIRED" } });
      summary.policiesExpired += 1;
      if (await this.suspendIfUncovered(policy.partnerId, today)) {
        summary.partnersSuspended += 1;
      }
    }
    return summary;
  }

  private async renewed(partnerId: string, policyId: string, expiresOn: Date): Promise<boolean> {
    const later = await this.prisma.partnerInsurancePolicy.count({ where: { partnerId, id: { not: policyId }, status: "VERIFIED", expiresOn: { gt: expiresOn } } });
    return later > 0;
  }

  private async suspendIfUncovered(partnerId: string, today: Date): Promise<boolean> {
    const suspended = await this.prisma.$transaction(async (tx) => {
      const partner = await tx.fulfilmentPartner.findUniqueOrThrow({ where: { id: partnerId } });
      if (partner.status !== "ACTIVE" || partner.requiredInsuranceMinor === 0n) {
        return false;
      }
      const covered = await tx.partnerInsurancePolicy.count({
        where: { partnerId, status: "VERIFIED", startsOn: { lte: today }, expiresOn: { gt: today }, coverMinor: { gte: partner.requiredInsuranceMinor } },
      });
      if (covered > 0) {
        return false;
      }
      const moved = await tx.fulfilmentPartner.updateMany({ where: { id: partnerId, status: "ACTIVE" }, data: { status: "SUSPENDED", statusReason: "Insurance expired" } });
      if (moved.count > 0) {
        await this.audit.record(
          {
            actor: SYSTEM_ACTOR,
            action: "partner.suspended_insurance",
            resourceType: "fulfilment_partner",
            resourceId: partnerId,
            countryCode: partner.countryCode,
            before: { status: "ACTIVE" },
            after: { status: "SUSPENDED" },
          },
          tx,
        );
      }
      return moved.count > 0;
    });
    if (suspended) {
      await this.notifier.notify(partnerId, PartnerEmails.insuranceExpired);
    }
    return suspended;
  }
}
