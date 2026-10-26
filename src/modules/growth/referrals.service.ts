import { Injectable, Logger } from "@nestjs/common";

import type { AuthPrincipal } from "../../common/auth/auth-principal";
import { isUniqueViolation, PrismaService } from "../../database/prisma.service";
import type { Prisma } from "../../generated/prisma/client";
import { referralRates, type VendorReferralView } from "../../shared";
import { FeeSchedulesService } from "../finance/fees/fee-schedules.service";
import { vendorIdOf } from "../onboarding/scope";
import { codeFor, normaliseCode } from "./referral-codes";

const CODE_ATTEMPTS = 6;

@Injectable()
export class ReferralsService {
  private readonly logger = new Logger(ReferralsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly fees: FeeSchedulesService,
  ) {}

  async attributePending(): Promise<number> {
    const pending = await this.prisma.vendor.findMany({ where: { signupReferralCode: { not: null } }, select: { id: true, countryCode: true, signupReferralCode: true }, take: 200 });
    for (const vendor of pending) {
      await this.prisma.$transaction(async (tx) => {
        const cleared = await tx.vendor.updateMany({ where: { id: vendor.id, signupReferralCode: vendor.signupReferralCode }, data: { signupReferralCode: null } });
        const known = await tx.referral.count({ where: { referredVendorId: vendor.id } });
        if (cleared.count > 0 && known === 0) {
          await this.attribute(tx, { vendorId: vendor.id, countryCode: vendor.countryCode }, vendor.signupReferralCode ?? undefined);
        }
      });
    }
    return pending.length;
  }

  private async attribute(tx: Prisma.TransactionClient, referred: { vendorId: string; countryCode: string }, rawCode: string | undefined): Promise<void> {
    const code = normaliseCode(rawCode);
    const owner = code ? await tx.referralCode.findUnique({ where: { code }, include: { vendor: true, campaign: true } }) : null;
    if (!code || !owner) {
      return;
    }
    if (owner.vendor) {
      if (owner.vendor.id === referred.vendorId || owner.vendor.countryCode !== referred.countryCode || owner.vendor.status !== "ACTIVE") {
        return;
      }
      const rates = referralRates((await this.fees.active(referred.countryCode, tx)).schedule);
      await tx.referral.create({
        data: {
          referredVendorId: referred.vendorId,
          referrerVendorId: owner.vendor.id,
          codeUsed: code,
          countryCode: referred.countryCode,
          referrerCreditMinor: BigInt(rates.referrerCreditMinor),
          refereeCreditMinor: BigInt(rates.refereeCreditMinor),
        },
      });
      return;
    }
    const campaign = owner.campaign!;
    const now = new Date();
    if (campaign.countryCode !== referred.countryCode || !campaign.active || (campaign.startsAt && campaign.startsAt > now) || (campaign.endsAt && campaign.endsAt <= now)) {
      return;
    }
    const counted = await tx.$executeRaw`UPDATE referral_campaigns SET signups = signups + 1 WHERE id = ${campaign.id}::uuid AND (max_signups IS NULL OR signups < max_signups)`;
    if (counted > 0) {
      await tx.referral.create({
        data: { referredVendorId: referred.vendorId, campaignId: campaign.id, codeUsed: code, countryCode: referred.countryCode, refereeCreditMinor: campaign.refereeCreditMinor },
      });
    }
  }

  async mine(principal: AuthPrincipal): Promise<VendorReferralView> {
    const vendorId = vendorIdOf(principal);
    const vendor = await this.prisma.vendor.findUniqueOrThrow({ where: { id: vendorId }, include: { country: { select: { currency: true } }, referralCode: true } });
    const code = vendor.referralCode?.code ?? (await this.issueCode(vendorId, vendor.businessName));
    const rates = referralRates((await this.fees.active(vendor.countryCode)).schedule);
    const made = await this.prisma.referral.findMany({ where: { referrerVendorId: vendorId }, select: { status: true, referrerCreditMinor: true } });
    const rewarded = made.filter((entry) => entry.status === "REWARDED");
    return {
      code,
      currency: vendor.country.currency,
      referrerCreditMinor: rates.referrerCreditMinor,
      refereeCreditMinor: rates.refereeCreditMinor,
      joined: made.filter((entry) => entry.status !== "VOID").length,
      rewarded: rewarded.length,
      earnedMinor: rewarded.reduce((total, entry) => total + Number(entry.referrerCreditMinor), 0),
    };
  }

  private async issueCode(vendorId: string, businessName: string): Promise<string> {
    for (let attempt = 0; attempt < CODE_ATTEMPTS; attempt += 1) {
      try {
        return (await this.prisma.referralCode.create({ data: { code: codeFor(businessName), vendorId } })).code;
      } catch (error) {
        if (!isUniqueViolation(error)) {
          throw error;
        }
        const existing = await this.prisma.referralCode.findUnique({ where: { vendorId } });
        if (existing) {
          return existing.code;
        }
      }
    }
    this.logger.error(`Couldn't find a free referral code for vendor ${vendorId}`);
    throw new Error("No free referral code");
  }
}
