import { DEFAULT_PARTNER_RATES, DEFAULT_REFERRAL_RATES, DEFAULT_SHOPPING_RATES, DEFAULT_STOREFRONT_RATES, type FeeSchedule } from "./fee-schedule";

const STANDARD: FeeSchedule = {
  onboarding: {
    SMALL: { negotiated: false, stockingMinor: 1200, firstMonthStorageMinor: 900 },
    MEDIUM: { negotiated: false, stockingMinor: 2200, firstMonthStorageMinor: 1400 },
    LARGE: { negotiated: false, stockingMinor: 4000, firstMonthStorageMinor: 1800 },
    X_LARGE: { negotiated: false, stockingMinor: 6000, firstMonthStorageMinor: 2500 },
    PALLET: { negotiated: true },
  },
  monthlyStorage: { SMALL: 900, MEDIUM: 1400, LARGE: 1800, X_LARGE: 2500, PALLET: 4500 },
  fulfilment: { baseMinor: 299, perAdditionalUnitMinor: 99, maxMinor: 1099 },
  returnsHandlingMinor: 600,
  shippingMarkupBps: 1000,
  firstShipmentWaivesStocking: true,
  adjustments: { dualApprovalAboveMinor: 50_000, dailyCapPerPersonMinor: 1_000_000 },
  partner: DEFAULT_PARTNER_RATES,
  storefront: DEFAULT_STOREFRONT_RATES,
  referral: DEFAULT_REFERRAL_RATES,
  shopping: DEFAULT_SHOPPING_RATES,
};

export const SEED_FEE_SCHEDULES: Readonly<Record<string, FeeSchedule>> = { GB: STANDARD, US: STANDARD };
