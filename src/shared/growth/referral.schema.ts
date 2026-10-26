import { z } from "zod";

export const referralCodeSchema = z
  .string()
  .trim()
  .toUpperCase()
  .regex(/^[A-Z0-9][A-Z0-9-]{2,39}$/, "Use 3 to 40 letters, numbers and hyphens");

export const REFERRAL_STATUSES = ["REGISTERED", "REWARDED", "VOID"] as const;
export type ReferralStatus = (typeof REFERRAL_STATUSES)[number];

export const referralCampaignSchema = z
  .object({
    countryCode: z.string().regex(/^[A-Z]{2}$/),
    code: referralCodeSchema,
    name: z.string().trim().min(3).max(80),
    refereeCreditMinor: z.number().int().min(0).max(1_000_000),
    startsAt: z.string().datetime().optional(),
    endsAt: z.string().datetime().optional(),
    maxSignups: z.number().int().min(1).max(1_000_000).optional(),
  })
  .refine((input) => !input.startsAt || !input.endsAt || input.endsAt > input.startsAt, { message: "The end must be after the start", path: ["endsAt"] });
export type ReferralCampaignInput = z.infer<typeof referralCampaignSchema>;

export const campaignActiveSchema = z.object({ active: z.boolean() });

export const voidReferralSchema = z.object({ reason: z.string().trim().min(5).max(200) });
export type VoidReferralInput = z.infer<typeof voidReferralSchema>;

export interface VendorReferralView {
  code: string;
  currency: string;
  referrerCreditMinor: number;
  refereeCreditMinor: number;
  joined: number;
  rewarded: number;
  earnedMinor: number;
}

export interface ReferralRowView {
  id: string;
  countryCode: string;
  currency: string;
  referredName: string;
  referrerName: string | null;
  campaignName: string | null;
  codeUsed: string;
  status: ReferralStatus;
  referrerCreditMinor: number;
  refereeCreditMinor: number;
  voidReason: string | null;
  createdAt: string;
  rewardedAt: string | null;
}

export interface ReferralCampaignView {
  id: string;
  countryCode: string;
  currency: string;
  code: string;
  name: string;
  refereeCreditMinor: number;
  startsAt: string | null;
  endsAt: string | null;
  maxSignups: number | null;
  signups: number;
  active: boolean;
  createdAt: string;
}
