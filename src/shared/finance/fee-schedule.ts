import { z } from "zod";

import { type StorageTier, STORAGE_TIERS } from "../stock/catalogue.schema";
import type { BoxCounts, ShippingMode } from "../stock/inbound.schema";

const minor = z.number().int().min(0).max(100_000_000);

const onboardingRateSchema = z.union([z.object({ negotiated: z.literal(true) }), z.object({ negotiated: z.literal(false).default(false), stockingMinor: minor, firstMonthStorageMinor: minor })]);

const share = z.number().int().min(0).max(10_000);

export const partnerRatesSchema = z.object({
  receivingShareBps: share,
  storageShareBps: share,
  fulfilmentShareBps: share,
  foundingBonusBps: z.number().int().min(0).max(3_000),
  foundingPlaces: z.number().int().min(0).max(100),
  holdbackBps: z.number().int().min(0).max(5_000),
  holdbackDays: z.number().int().min(0).max(365),
});
export type PartnerRates = z.infer<typeof partnerRatesSchema>;

export const DEFAULT_PARTNER_RATES: PartnerRates = {
  receivingShareBps: 7000,
  storageShareBps: 7000,
  fulfilmentShareBps: 7000,
  foundingBonusBps: 500,
  foundingPlaces: 5,
  holdbackBps: 2000,
  holdbackDays: 60,
};

export const storefrontRatesSchema = z.object({ setupFeeMinor: minor, commissionBps: z.number().int().min(0).max(3_000), minimumHoldHours: z.number().int().min(0).max(720) });
export type StorefrontRates = z.infer<typeof storefrontRatesSchema>;

export const DEFAULT_STOREFRONT_RATES: StorefrontRates = { setupFeeMinor: 2_500, commissionBps: 0, minimumHoldHours: 24 };

export const referralRatesSchema = z.object({ referrerCreditMinor: minor, refereeCreditMinor: minor, monthlyRewardsPerReferrer: z.number().int().min(0).max(100) });
export type ReferralRates = z.infer<typeof referralRatesSchema>;

export const DEFAULT_REFERRAL_RATES: ReferralRates = { referrerCreditMinor: 1_000, refereeCreditMinor: 1_000, monthlyRewardsPerReferrer: 10 };

export const shoppingRatesSchema = z.object({ commissionBps: z.number().int().min(0).max(5_000), minimumFeeMinor: minor });
export type ShoppingRates = z.infer<typeof shoppingRatesSchema>;

export const DEFAULT_SHOPPING_RATES: ShoppingRates = { commissionBps: 1_500, minimumFeeMinor: 500 };

export const feeScheduleSchema = z.object({
  onboarding: z.object(Object.fromEntries(STORAGE_TIERS.map((tier) => [tier, onboardingRateSchema])) as Record<StorageTier, typeof onboardingRateSchema>),
  monthlyStorage: z.object(Object.fromEntries(STORAGE_TIERS.map((tier) => [tier, minor.nullable()])) as Record<StorageTier, z.ZodNullable<typeof minor>>),
  fulfilment: z
    .object({ baseMinor: minor, perAdditionalUnitMinor: minor, maxMinor: minor })
    .refine((fulfilment) => fulfilment.maxMinor >= fulfilment.baseMinor, { message: "The cap can't be below the base fee", path: ["maxMinor"] }),
  returnsHandlingMinor: minor,
  shippingMarkupBps: z.number().int().min(0).max(5_000),
  firstShipmentWaivesStocking: z.boolean(),
  adjustments: z.object({ dualApprovalAboveMinor: minor, dailyCapPerPersonMinor: minor.min(1) }),
  partner: partnerRatesSchema.default(DEFAULT_PARTNER_RATES),
  storefront: storefrontRatesSchema.default(DEFAULT_STOREFRONT_RATES),
  referral: referralRatesSchema.default(DEFAULT_REFERRAL_RATES),
  shopping: shoppingRatesSchema.default(DEFAULT_SHOPPING_RATES),
});
export type FeeSchedule = z.infer<typeof feeScheduleSchema>;

export const FEE_SCHEDULE_STATUSES = ["PROPOSED", "ACTIVE", "REJECTED", "SUPERSEDED"] as const;
export type FeeScheduleStatus = (typeof FEE_SCHEDULE_STATUSES)[number];

export const proposeFeeScheduleSchema = z.object({ schedule: feeScheduleSchema, note: z.string().trim().min(10).max(500) });
export type ProposeFeeScheduleInput = z.infer<typeof proposeFeeScheduleSchema>;

export const feeScheduleDecisionSchema = z.object({ approve: z.boolean(), note: z.string().trim().min(10).max(500) });
export type FeeScheduleDecisionInput = z.infer<typeof feeScheduleDecisionSchema>;

export type VendorFeeSchedule = Omit<FeeSchedule, "adjustments" | "partner" | "shopping">;

export function storefrontRates(schedule: { storefront?: unknown }): StorefrontRates {
  const parsed = storefrontRatesSchema.safeParse(schedule.storefront ?? DEFAULT_STOREFRONT_RATES);
  return parsed.success ? parsed.data : DEFAULT_STOREFRONT_RATES;
}

export function referralRates(schedule: { referral?: unknown }): ReferralRates {
  const parsed = referralRatesSchema.safeParse(schedule.referral ?? DEFAULT_REFERRAL_RATES);
  return parsed.success ? parsed.data : DEFAULT_REFERRAL_RATES;
}

export function shoppingRates(schedule: { shopping?: unknown }): ShoppingRates {
  const parsed = shoppingRatesSchema.safeParse(schedule.shopping ?? DEFAULT_SHOPPING_RATES);
  return parsed.success ? parsed.data : DEFAULT_SHOPPING_RATES;
}

export function shoppingCommission(rates: ShoppingRates, goodsMinor: number): number {
  return goodsMinor === 0 ? 0 : Math.max(rates.minimumFeeMinor, Math.round((goodsMinor * rates.commissionBps) / 10_000));
}

export function vendorFeeSchedule(schedule: FeeSchedule): VendorFeeSchedule {
  const { onboarding, monthlyStorage, fulfilment, returnsHandlingMinor, shippingMarkupBps, firstShipmentWaivesStocking, storefront } = schedule;
  return { onboarding, monthlyStorage, fulfilment, returnsHandlingMinor, shippingMarkupBps, firstShipmentWaivesStocking, storefront, referral: referralRates(schedule) };
}

export interface VendorFeesView {
  currency: string;
  schedule: VendorFeeSchedule;
}

export interface FeeScheduleView {
  id: string;
  countryCode: string;
  currency: string;
  version: number;
  status: FeeScheduleStatus;
  schedule: FeeSchedule;
  note: string;
  proposedByEmail: string;
  proposedAt: string;
  decidedByEmail: string | null;
  decidedAt: string | null;
  decisionNote: string | null;
}

export class FeeQuoteError extends Error {
  constructor(
    readonly field: string,
    message: string,
  ) {
    super(message);
    this.name = "FeeQuoteError";
  }
}

export interface OnboardingQuote {
  stockingMinor: number;
  storageMinor: number;
  waivedMinor: number;
  totalMinor: number;
}

export function onboardingFee(schedule: FeeSchedule, boxes: BoxCounts, mode: ShippingMode, firstShipment: boolean): OnboardingQuote {
  let stockingMinor = 0;
  let storageMinor = 0;
  for (const tier of STORAGE_TIERS) {
    const count = boxes[tier] ?? 0;
    if (count === 0) {
      continue;
    }
    if (tier === "PALLET") {
      const palletRate = schedule.monthlyStorage.PALLET;
      if (mode !== "PALLET" || palletRate === null) {
        throw new FeeQuoteError("boxCounts", mode === "PALLET" ? "Pallets are priced by quote in this market. Contact us before sending." : "Choose pallet shipping to send pallets.");
      }
      storageMinor += palletRate * count;
      continue;
    }
    const rate = schedule.onboarding[tier];
    if (rate.negotiated) {
      throw new FeeQuoteError("boxCounts", "This box size is priced by quote in this market. Contact us before sending.");
    }
    stockingMinor += rate.stockingMinor * count;
    storageMinor += mode === "PALLET" ? 0 : rate.firstMonthStorageMinor * count;
  }
  const waivedMinor = firstShipment && schedule.firstShipmentWaivesStocking ? stockingMinor : 0;
  return { stockingMinor, storageMinor, waivedMinor, totalMinor: stockingMinor + storageMinor - waivedMinor };
}

export function fulfilmentFee(schedule: Pick<FeeSchedule, "fulfilment">, units: number): number {
  const { baseMinor, perAdditionalUnitMinor, maxMinor } = schedule.fulfilment;
  return Math.min(baseMinor + Math.max(0, units - 1) * perAdditionalUnitMinor, maxMinor);
}

export function partnerRates(schedule: { partner?: unknown }): PartnerRates {
  const parsed = partnerRatesSchema.safeParse(schedule.partner);
  return parsed.success ? parsed.data : DEFAULT_PARTNER_RATES;
}

export function partnerShare(amountMinor: number, shareBps: number, founding: boolean, rates: PartnerRates): number {
  const effective = Math.min(10_000, shareBps + (founding ? rates.foundingBonusBps : 0));
  return Math.floor((amountMinor * effective) / 10_000);
}

export function splitHoldback(amountMinor: number, rates: PartnerRates): { availableMinor: number; heldMinor: number } {
  const heldMinor = Math.floor((amountMinor * rates.holdbackBps) / 10_000);
  return { availableMinor: amountMinor - heldMinor, heldMinor };
}

export function shippingWithMarkup(schedule: FeeSchedule, carrierCostMinor: number): number {
  return carrierCostMinor + Math.ceil((carrierCostMinor * schedule.shippingMarkupBps) / 10_000);
}

export function monthlyStorageFee(schedule: FeeSchedule, tier: StorageTier): number | null {
  return schedule.monthlyStorage[tier];
}
