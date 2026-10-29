import { z } from "zod";

import { isSupportedCurrency } from "../money/currency";

export const COUNTRY_STATUSES = ["PROSPECTIVE", "ONBOARDING", "LIVE", "SUSPENDED", "CLOSED"] as const;
export type CountryStatus = (typeof COUNTRY_STATUSES)[number];

export const TAX_MODELS = ["SALES_TAX", "VAT", "GST", "NONE"] as const;
export type TaxModel = (typeof TAX_MODELS)[number];

export const MEASUREMENT_SYSTEMS = ["METRIC", "IMPERIAL"] as const;
export type MeasurementSystem = (typeof MEASUREMENT_SYSTEMS)[number];

export const isoCountryCode = z.string().regex(/^[A-Z]{2}$/, "Use a two-letter ISO 3166-1 country code");

const currencyCode = z
  .string()
  .regex(/^[A-Z]{3}$/)
  .refine(isSupportedCurrency, "Currency is not supported yet");

const safePattern = z
  .string()
  .max(200)
  .refine((pattern) => {
    try {
      new RegExp(pattern);
      return true;
    } catch {
      return false;
    }
  }, "Must be a valid regular expression");

const optionCode = z.string().regex(/^[A-Z][A-Z0-9_]{1,39}$/);

const labelledOption = z.object({ code: optionCode, label: z.string().min(1).max(80) });

export const addressRulesSchema = z.object({
  postalCodeLabel: z.string().min(1).max(40),
  postalCodePattern: safePattern,
  regionLabel: z.string().min(1).max(40),
  regionRequired: z.boolean(),
  regionCodes: z.array(z.string().min(1).max(10)).max(100).default([]),
});

export const taxRulesSchema = z.object({
  model: z.enum(TAX_MODELS),
  standardRateBps: z.number().int().min(0).max(5000),
  pricesIncludeTax: z.boolean(),
  registrationLabel: z.string().max(60).optional(),
  regionalRatesBps: z.record(z.string().regex(/^[A-Z0-9]{1,6}$/), z.number().int().min(0).max(5000)).optional(),
});

export const identifierRuleSchema = z.object({ label: z.string().min(1).max(60), pattern: safePattern.optional(), required: z.boolean() });

export const KYC_PROVIDERS = ["MANUAL"] as const;

export const kycRulesetSchema = z.object({
  provider: z.enum(KYC_PROVIDERS).default("MANUAL"),
  businessTypes: z.array(labelledOption).min(1).max(20),
  idTypes: z.array(labelledOption).min(1).max(10),
  companyNumber: identifierRuleSchema,
  taxNumber: identifierRuleSchema.optional(),
});

const amountMinor = z.number().int().min(0).max(10_000_000_000);

export const partnerTierSchema = z.object({
  level: z.number().int().min(1).max(10),
  name: z.string().trim().min(2).max(40),
  maxStockValueMinor: amountMinor,
  maxItemValueMinor: amountMinor,
  minCleanOrders: z.number().int().min(0).max(100_000),
  minPassedCounts: z.number().int().min(0).max(1_000),
  minDaysActive: z.number().int().min(0).max(3_650),
});
export type PartnerTier = z.infer<typeof partnerTierSchema>;

export const DEFAULT_PARTNER_TIERS: PartnerTier[] = [
  { level: 1, name: "Starter", maxStockValueMinor: 50_000, maxItemValueMinor: 10_000, minCleanOrders: 0, minPassedCounts: 0, minDaysActive: 0 },
  { level: 2, name: "Trusted", maxStockValueMinor: 300_000, maxItemValueMinor: 50_000, minCleanOrders: 50, minPassedCounts: 2, minDaysActive: 30 },
  { level: 3, name: "Established", maxStockValueMinor: 1_500_000, maxItemValueMinor: 200_000, minCleanOrders: 250, minPassedCounts: 6, minDaysActive: 90 },
];

export const partnerProgrammeSchema = z.object({
  acceptingApplications: z.boolean().default(false),
  taxId: identifierRuleSchema.default({ label: "Tax reference", required: false }),
  workDeclaration: z.string().trim().min(20).max(600).default("I can legally work or trade as self-employed in this country, and I'll declare what I earn here for tax."),
  depositMinor: amountMinor.default(0),
  insuranceCoverMinor: amountMinor.default(0),
  platformInsuranceCoverMinor: amountMinor.default(0),
  proofOfAddressRetentionDays: z.number().int().min(30).max(730).default(90),
  mysteryVendorId: z.string().uuid().optional(),
  cycleCountDays: z.number().int().min(0).max(365).default(30),
  shrinkageAlertBps: z.number().int().min(10).max(5_000).default(200),
  trustFloor: z.number().int().min(0).max(100).default(50),
  trustForPromotion: z.number().int().min(0).max(100).default(80),
  highValueOrderMinor: amountMinor.default(25_000),
  noScanAlertHours: z.number().int().min(12).max(240).default(48),
  tiers: z
    .array(partnerTierSchema)
    .min(1)
    .max(10)
    .refine((tiers) => tiers.every((tier, index) => tier.level === index + 1), { message: "Number tiers 1, 2, 3… in order" })
    .default(DEFAULT_PARTNER_TIERS),
});
export type PartnerProgramme = z.infer<typeof partnerProgrammeSchema>;

export function partnerProgramme(config: { partners?: unknown }): PartnerProgramme {
  const parsed = partnerProgrammeSchema.safeParse(config.partners ?? {});
  return parsed.success ? parsed.data : partnerProgrammeSchema.parse({});
}

export function tierFor(programme: PartnerProgramme, level: number): PartnerTier {
  return programme.tiers.find((tier) => tier.level === level) ?? programme.tiers[0]!;
}

export const countryConfigSchema = z.object({
  locale: z.string().regex(/^[a-z]{2}-[A-Z]{2}$/),
  phoneCountryCode: z.string().regex(/^\+\d{1,4}$/),
  measurementSystem: z.enum(MEASUREMENT_SYSTEMS),
  address: addressRulesSchema,
  tax: taxRulesSchema,
  kyc: kycRulesetSchema,
  carrierCodes: z
    .array(z.string().regex(/^[a-z0-9_]{2,40}$/))
    .max(20)
    .default([]),
  feeScheduleKey: z.string().regex(/^[a-z0-9_]{3,60}$/),
  partners: partnerProgrammeSchema.prefault({}),
  activationFeeMinor: amountMinor.default(0),
});

export const STANDARD_ACTIVATION_FEE_MINOR = 1_000;

export const activationFeeSchema = z.object({ activationFeeMinor: amountMinor });
export type ActivationFeeInput = z.infer<typeof activationFeeSchema>;

export function activationFeeOf(config: { activationFeeMinor?: unknown }): number {
  const parsed = amountMinor.safeParse(config.activationFeeMinor);
  return parsed.success ? parsed.data : 0;
}

export const createCountrySchema = z.object({ code: isoCountryCode, name: z.string().min(2).max(80), currency: currencyCode, config: countryConfigSchema });

export const updateCountrySchema = z.object({ name: z.string().min(2).max(80).optional(), config: countryConfigSchema.optional() });

export const changeCountryStatusSchema = z.object({ status: z.enum(COUNTRY_STATUSES), reason: z.string().min(3).max(500) });

export type AddressRules = z.infer<typeof addressRulesSchema>;
export type TaxRules = z.infer<typeof taxRulesSchema>;
export type KycRuleset = z.infer<typeof kycRulesetSchema>;
export type CountryConfig = z.infer<typeof countryConfigSchema>;
export type CreateCountryInput = z.infer<typeof createCountrySchema>;
export type UpdateCountryInput = z.infer<typeof updateCountrySchema>;
export type ChangeCountryStatusInput = z.infer<typeof changeCountryStatusSchema>;

export interface PublicCountry {
  code: string;
  name: string;
  currency: string;
  status: CountryStatus;
  locale: string;
  measurementSystem: (typeof MEASUREMENT_SYSTEMS)[number];
}

export interface DestinationView {
  code: string;
  name: string;
  customsRequired: boolean;
  address: AddressRules;
}
