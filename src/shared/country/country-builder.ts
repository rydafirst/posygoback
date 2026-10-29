import { type CreateCountryInput, DEFAULT_PARTNER_TIERS, STANDARD_ACTIVATION_FEE_MINOR } from "./country.schema";

export interface MajorCountry {
  code: string;
  name: string;
  currency: string;
  locale: string;
  phoneCountryCode: string;
  postalCodeLabel: string;
  postalCodePattern: string;
  regionLabel: string;
  regionCodes?: string[];
  tax: { model: "VAT" | "GST"; standardRateBps: number; pricesIncludeTax: boolean; registrationLabel: string };
  businessTypes: Array<[string, string]>;
  idTypes: Array<[string, string]>;
  companyNumber: { label: string; pattern?: string };
  taxNumber?: { label: string; pattern?: string };
  carrierCodes: string[];
  partnerTaxId: { label: string; pattern?: string };
  workDeclaration: string;
}

export const EU_IDS: Array<[string, string]> = [
  ["PASSPORT", "Passport"],
  ["NATIONAL_ID", "National identity card"],
  ["DRIVING_LICENCE", "Driving licence"],
  ["RESIDENCE_PERMIT", "Residence permit"],
];

export function toCountry(country: MajorCountry): CreateCountryInput {
  return {
    code: country.code,
    name: country.name,
    currency: country.currency,
    config: {
      locale: country.locale,
      phoneCountryCode: country.phoneCountryCode,
      measurementSystem: "METRIC",
      address: {
        postalCodeLabel: country.postalCodeLabel,
        postalCodePattern: country.postalCodePattern,
        regionLabel: country.regionLabel,
        regionRequired: Boolean(country.regionCodes?.length),
        regionCodes: country.regionCodes ?? [],
      },
      tax: country.tax,
      kyc: {
        provider: "MANUAL",
        businessTypes: country.businessTypes.map(([code, label]) => ({ code, label })),
        idTypes: country.idTypes.map(([code, label]) => ({ code, label })),
        companyNumber: { ...country.companyNumber, required: false },
        ...(country.taxNumber ? { taxNumber: { ...country.taxNumber, required: false } } : {}),
      },
      carrierCodes: country.carrierCodes,
      feeScheduleKey: `fee_schedule_${country.code.toLowerCase()}`,
      partners: {
        acceptingApplications: true,
        taxId: { ...country.partnerTaxId, required: false },
        workDeclaration: country.workDeclaration,
        depositMinor: 0,
        insuranceCoverMinor: 0,
        platformInsuranceCoverMinor: 1_000_000,
        proofOfAddressRetentionDays: 90,
        cycleCountDays: 30,
        shrinkageAlertBps: 200,
        trustFloor: 50,
        trustForPromotion: 80,
        highValueOrderMinor: 25_000,
        noScanAlertHours: 48,
        tiers: DEFAULT_PARTNER_TIERS,
      },
      activationFeeMinor: STANDARD_ACTIVATION_FEE_MINOR,
    },
  };
}

export const EU_WORK = (country: string, authority: string) => `I can legally work or trade as self-employed in ${country}, and I'll declare what I earn to ${authority}.`;
