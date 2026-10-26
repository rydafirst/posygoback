import { Injectable } from "@nestjs/common";

import type { AuthPrincipal, RequestMeta } from "../../common/auth/auth-principal";
import { Errors } from "../../common/http/app-exception";
import { isUniqueViolation, PrismaService } from "../../database/prisma.service";
import type { ReferralCampaign } from "../../generated/prisma/client";
import { AuditService } from "../../infrastructure/audit/audit.service";
import type { ReferralCampaignInput, ReferralCampaignView, ReferralRowView } from "../../shared";
import { reviewerCountryScope } from "../onboarding/scope";

const PAGE = 200;
const CAMPAIGN_INCLUDE = { code: { select: { code: true } }, country: { select: { currency: true } } } as const;

function campaignView(row: ReferralCampaign & { code: { code: string } | null; country: { currency: string } }): ReferralCampaignView {
  return {
    id: row.id,
    countryCode: row.countryCode,
    currency: row.country.currency,
    code: row.code?.code ?? "",
    name: row.name,
    refereeCreditMinor: Number(row.refereeCreditMinor),
    startsAt: row.startsAt?.toISOString() ?? null,
    endsAt: row.endsAt?.toISOString() ?? null,
    maxSignups: row.maxSignups,
    signups: row.signups,
    active: row.active,
    createdAt: row.createdAt.toISOString(),
  };
}

@Injectable()
export class ReferralAdminService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async referrals(principal: AuthPrincipal): Promise<ReferralRowView[]> {
    const country = reviewerCountryScope(principal);
    const rows = await this.prisma.referral.findMany({
      where: country ? { countryCode: country } : {},
      include: { referred: { select: { businessName: true } }, referrer: { select: { businessName: true } }, campaign: { select: { name: true } }, country: { select: { currency: true } } },
      orderBy: { createdAt: "desc" },
      take: PAGE,
    });
    return rows.map((row) => ({
      id: row.id,
      countryCode: row.countryCode,
      currency: row.country.currency,
      referredName: row.referred.businessName,
      referrerName: row.referrer?.businessName ?? null,
      campaignName: row.campaign?.name ?? null,
      codeUsed: row.codeUsed,
      status: row.status,
      referrerCreditMinor: Number(row.referrerCreditMinor),
      refereeCreditMinor: Number(row.refereeCreditMinor),
      voidReason: row.voidReason,
      createdAt: row.createdAt.toISOString(),
      rewardedAt: row.rewardedAt?.toISOString() ?? null,
    }));
  }

  async voidReferral(principal: AuthPrincipal, referralId: string, reason: string, meta: RequestMeta): Promise<ReferralRowView[]> {
    const country = reviewerCountryScope(principal);
    const updated = await this.prisma.referral.updateMany({
      where: { id: referralId, status: "REGISTERED", ...(country ? { countryCode: country } : {}) },
      data: { status: "VOID", voidReason: reason },
    });
    if (updated.count === 0) {
      throw Errors.invalidTransition("Only referrals that haven't been rewarded yet can be cancelled.");
    }
    await this.audit.record({ actor: { userId: principal.userId, role: principal.role }, action: "referral.voided", resourceType: "referral", resourceId: referralId, after: { reason }, meta });
    return this.referrals(principal);
  }

  async campaigns(principal: AuthPrincipal): Promise<ReferralCampaignView[]> {
    const country = reviewerCountryScope(principal);
    const rows = await this.prisma.referralCampaign.findMany({ where: country ? { countryCode: country } : {}, include: CAMPAIGN_INCLUDE, orderBy: { createdAt: "desc" }, take: PAGE });
    return rows.map(campaignView);
  }

  async createCampaign(principal: AuthPrincipal, input: ReferralCampaignInput, meta: RequestMeta): Promise<ReferralCampaignView> {
    try {
      const created = await this.prisma.$transaction(async (tx) => {
        const campaign = await tx.referralCampaign.create({
          data: {
            countryCode: input.countryCode,
            name: input.name,
            refereeCreditMinor: BigInt(input.refereeCreditMinor),
            startsAt: input.startsAt ? new Date(input.startsAt) : null,
            endsAt: input.endsAt ? new Date(input.endsAt) : null,
            maxSignups: input.maxSignups ?? null,
            createdBy: principal.userId,
          },
        });
        await tx.referralCode.create({ data: { code: input.code, campaignId: campaign.id } });
        await this.audit.record(
          {
            actor: { userId: principal.userId, role: principal.role },
            action: "referral.campaign_created",
            resourceType: "referral_campaign",
            resourceId: campaign.id,
            countryCode: input.countryCode,
            after: input,
            meta,
          },
          tx,
        );
        return tx.referralCampaign.findUniqueOrThrow({ where: { id: campaign.id }, include: CAMPAIGN_INCLUDE });
      });
      return campaignView(created);
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw Errors.validation({ code: ["That code is already in use"] });
      }
      throw error;
    }
  }

  async setActive(principal: AuthPrincipal, campaignId: string, active: boolean, meta: RequestMeta): Promise<ReferralCampaignView> {
    const updated = await this.prisma.referralCampaign.updateMany({ where: { id: campaignId }, data: { active } });
    if (updated.count === 0) {
      throw Errors.notFound();
    }
    await this.audit.record({
      actor: { userId: principal.userId, role: principal.role },
      action: active ? "referral.campaign_started" : "referral.campaign_stopped",
      resourceType: "referral_campaign",
      resourceId: campaignId,
      meta,
    });
    return campaignView(await this.prisma.referralCampaign.findUniqueOrThrow({ where: { id: campaignId }, include: CAMPAIGN_INCLUDE }));
  }
}
