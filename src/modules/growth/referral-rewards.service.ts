import { Injectable } from "@nestjs/common";

import { PrismaService } from "../../database/prisma.service";
import type { Prisma } from "../../generated/prisma/client";
import { SYSTEM_ACTOR, AuditService } from "../../infrastructure/audit/audit.service";
import { Money, referralRates } from "../../shared";
import { FeeSchedulesService } from "../finance/fees/fee-schedules.service";
import { WalletAlertsService } from "../finance/wallets/wallet-alerts.service";
import { WalletLedgerService } from "../finance/wallets/wallet-ledger.service";
import { ReferralEmails } from "./referral-emails";

const BATCH = 200;

interface Credit {
  vendorId: string;
  amountMinor: number;
}

interface PaidCredit extends Credit {
  currency: string;
  welcome: boolean;
}

function startOfMonth(now: Date): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
}

@Injectable()
export class ReferralRewardsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly ledger: WalletLedgerService,
    private readonly fees: FeeSchedulesService,
    private readonly owners: WalletAlertsService,
    private readonly audit: AuditService,
  ) {}

  async rewardDue(now = new Date()): Promise<number> {
    const due = await this.prisma.referral.findMany({
      where: { status: "REGISTERED", referred: { status: "ACTIVE", inboundShipments: { some: { receivedAt: { not: null } } } } },
      select: { id: true },
      take: BATCH,
    });
    let rewarded = 0;
    for (const { id } of due) {
      const credits = await this.prisma.$transaction((tx) => this.reward(tx, id, now));
      for (const credit of credits) {
        rewarded += 1;
        const amount = Money.of(credit.amountMinor, credit.currency).format("en-GB");
        await this.owners
          .notifyOwner(
            credit.vendorId,
            (to, webUrl) => (credit.welcome ? ReferralEmails.welcomeCredit(to, amount, webUrl) : ReferralEmails.rewarded(to, amount, webUrl)),
            credit.welcome ? "/wallet" : "/settings/referrals",
          )
          .catch(() => undefined);
      }
    }
    return rewarded;
  }

  private async reward(tx: Prisma.TransactionClient, referralId: string, now: Date): Promise<PaidCredit[]> {
    const claimed = await tx.referral.updateMany({ where: { id: referralId, status: "REGISTERED" }, data: { status: "REWARDED", rewardedAt: now } });
    if (claimed.count === 0) {
      return [];
    }
    const referral = await tx.referral.findUniqueOrThrow({ where: { id: referralId }, include: { country: { select: { currency: true } } } });
    const credits: Credit[] = [{ vendorId: referral.referredVendorId, amountMinor: Number(referral.refereeCreditMinor) }];
    if (referral.referrerVendorId && (await this.underMonthlyCap(tx, referral.referrerVendorId, referral.countryCode, referralId, now))) {
      credits.push({ vendorId: referral.referrerVendorId, amountMinor: Number(referral.referrerCreditMinor) });
    } else if (referral.referrerVendorId) {
      await tx.referral.update({ where: { id: referralId }, data: { referrerCreditMinor: 0n } });
    }
    const paid: PaidCredit[] = [];
    for (const credit of credits.filter((entry) => entry.amountMinor > 0)) {
      const wallet = await this.ledger.walletFor(tx, credit.vendorId, referral.country.currency);
      await this.ledger.post(tx, wallet.id, {
        type: "REFERRAL_CREDIT",
        amountMinor: credit.amountMinor,
        description: credit.vendorId === referral.referredVendorId ? "Welcome credit for joining with a referral" : "Referral credit: a business you referred is up and running",
        idempotencyKey: `referral:${referralId}:${credit.vendorId}`,
        reference: { type: "referral", id: referralId },
      });
      paid.push({ ...credit, currency: referral.country.currency, welcome: credit.vendorId === referral.referredVendorId });
    }
    const credited = paid.map(({ vendorId, amountMinor, currency }) => ({ vendorId, amountMinor, currency }));
    await this.audit.record(
      { actor: SYSTEM_ACTOR, action: "referral.rewarded", resourceType: "referral", resourceId: referralId, countryCode: referral.countryCode, after: { credits: credited } },
      tx,
    );
    return paid;
  }

  private async underMonthlyCap(tx: Prisma.TransactionClient, referrerId: string, countryCode: string, referralId: string, now: Date): Promise<boolean> {
    const cap = referralRates((await this.fees.active(countryCode, tx)).schedule).monthlyRewardsPerReferrer;
    const thisMonth = await tx.referral.count({
      where: { referrerVendorId: referrerId, status: "REWARDED", rewardedAt: { gte: startOfMonth(now) }, referrerCreditMinor: { gt: 0 }, id: { not: referralId } },
    });
    return thisMonth < cap;
  }
}
