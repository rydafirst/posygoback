import { z } from "zod";

import type { AddressRules, KycRuleset } from "../country/country.schema";
import { isIsoCountryCode } from "../country/iso-countries";
import type { IdentityCheckView } from "../identity/identity-check.views";

export const VERIFICATION_STATUSES = ["NOT_STARTED", "IN_PROGRESS", "SUBMITTED", "APPROVED", "REJECTED", "RESUBMISSION_REQUIRED"] as const;
export type VerificationStatus = (typeof VERIFICATION_STATUSES)[number];

export const EDITABLE_VERIFICATION_STATUSES: readonly VerificationStatus[] = ["NOT_STARTED", "IN_PROGRESS", "RESUBMISSION_REQUIRED"];

export const MONTHLY_UNIT_BANDS = ["UP_TO_100", "UP_TO_1000", "UP_TO_10000", "OVER_10000"] as const;
export const MONTHLY_ORDER_BANDS = ["UP_TO_50", "UP_TO_500", "UP_TO_5000", "OVER_5000"] as const;
export const PRODUCT_HAZARDS = ["BATTERIES", "LIQUIDS", "FRAGILE", "FLAMMABLE", "NONE"] as const;
export const DOCUMENT_SLOTS = ["idFront", "idBack", "selfie", "businessDocument"] as const;
export type DocumentSlot = (typeof DOCUMENT_SLOTS)[number];

export interface VerificationMarket {
  countryCode: string;
  kyc: KycRuleset;
  address: AddressRules;
}

const text = (min: number, max: number) => z.string().trim().min(min).max(max);
const fileId = z.string().uuid("Upload this document");
const countryCode = z
  .string()
  .regex(/^[A-Z]{2}$/)
  .refine(isIsoCountryCode, "Choose a country");

function codesOf(options: ReadonlyArray<{ code: string }>): [string, ...string[]] {
  const codes = options.map((option) => option.code);
  return [codes[0] ?? "UNKNOWN", ...codes.slice(1)];
}

function buildShape(market: VerificationMarket) {
  return {
    businessType: z.enum(codesOf(market.kyc.businessTypes), { message: "Choose a business type" }),
    legalBusinessName: text(2, 160),
    registrationCountryCode: countryCode,
    companyNumber: z.string().trim().toUpperCase().max(40).optional(),
    taxNumber: z.string().trim().toUpperCase().max(40).optional(),
    registeredAddress: z.object({
      line1: text(2, 120),
      line2: z.string().trim().max(120).optional(),
      city: text(2, 80),
      region: z.string().trim().max(80).optional(),
      postalCode: z.string().trim().toUpperCase().min(2).max(16),
    }),
    contactFullName: text(2, 120),
    contactRole: text(2, 80),
    contactPhone: z
      .string()
      .trim()
      .regex(/^\+[1-9]\d{6,14}$/, "Use international format, e.g. +447700900123"),
    idType: z.enum(codesOf(market.kyc.idTypes), { message: "Choose an ID type" }).optional(),
    idExpiry: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/, "Use the date picker")
      .optional(),
    documents: z.object({ idFront: fileId.optional(), idBack: fileId.optional(), selfie: fileId.optional(), businessDocument: fileId }),
    productsDescription: text(10, 1000),
    monthlyUnits: z.enum(MONTHLY_UNIT_BANDS),
    monthlyOrders: z.enum(MONTHLY_ORDER_BANDS),
    hazards: z.array(z.enum(PRODUCT_HAZARDS)).min(1, "Choose at least one, or None").max(PRODUCT_HAZARDS.length),
  };
}

function matches(pattern: string | undefined, value: string): boolean {
  return !pattern || new RegExp(pattern).test(value.replace(/\s/g, ""));
}

export function buildVerificationSchemas(market: VerificationMarket) {
  const base = z.object(buildShape(market));
  const draft = base.partial().extend({ registeredAddress: base.shape.registeredAddress.partial().optional(), documents: base.shape.documents.partial().optional() });
  const submission = base.superRefine((value, context) => {
    const domestic = value.registrationCountryCode === market.countryCode;
    const { companyNumber, taxNumber } = market.kyc;
    if (domestic && companyNumber.required && !value.companyNumber) {
      context.addIssue({ code: "custom", path: ["companyNumber"], message: `Enter your ${companyNumber.label}` });
    }
    if (domestic && value.companyNumber && !matches(companyNumber.pattern, value.companyNumber)) {
      context.addIssue({ code: "custom", path: ["companyNumber"], message: `That doesn't look like a valid ${companyNumber.label}` });
    }
    if (domestic && taxNumber && value.taxNumber && !matches(taxNumber.pattern, value.taxNumber)) {
      context.addIssue({ code: "custom", path: ["taxNumber"], message: `That doesn't look like a valid ${taxNumber.label}` });
    }
    if (domestic && !new RegExp(market.address.postalCodePattern).test(value.registeredAddress.postalCode)) {
      context.addIssue({ code: "custom", path: ["registeredAddress", "postalCode"], message: `Enter a valid ${market.address.postalCodeLabel}` });
    }
    if (domestic && market.address.regionRequired && !value.registeredAddress.region) {
      context.addIssue({ code: "custom", path: ["registeredAddress", "region"], message: `Enter the ${market.address.regionLabel}` });
    }
    if (value.hazards.includes("NONE") && value.hazards.length > 1) {
      context.addIssue({ code: "custom", path: ["hazards"], message: "None can't be combined with other hazards" });
    }
  });
  return { draft, submission };
}

export type VerificationDraft = z.infer<ReturnType<typeof buildVerificationSchemas>["draft"]>;
export type VerificationSubmission = z.infer<ReturnType<typeof buildVerificationSchemas>["submission"]>;

export const verificationDecisionSchema = z
  .object({ decision: z.enum(["APPROVE", "REJECT", "REQUEST_RESUBMISSION"]), reason: z.string().trim().max(1000).optional() })
  .refine((value) => value.decision === "APPROVE" || (value.reason?.length ?? 0) >= 10, { path: ["reason"], message: "Tell the vendor what needs to change (at least 10 characters)" });
export type VerificationDecisionInput = z.infer<typeof verificationDecisionSchema>;

export interface VerificationDocumentView {
  slot: DocumentSlot;
  fileId: string;
  status: "PENDING_UPLOAD" | "VERIFIED" | "REJECTED" | "PURGED";
}

export interface VerificationView {
  status: VerificationStatus;
  market: VerificationMarket;
  draft: VerificationDraft;
  idNumberLast4: string | null;
  identityCheck: IdentityCheckView | null;
  documents: VerificationDocumentView[];
  submittedAt: string | null;
  decisionReason: string | null;
}
