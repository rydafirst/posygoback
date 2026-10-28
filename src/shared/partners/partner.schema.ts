import { z } from "zod";

import { isoCountryCode } from "../country/country.schema";
import { signatureSchema } from "../onboarding/signature.schema";
import { recipientSchema } from "../orders/recipient";

export const PARTNER_KINDS = ["INDIVIDUAL", "COMPANY"] as const;
export type PartnerKind = (typeof PARTNER_KINDS)[number];

export const PARTNER_LEGAL_KINDS = ["PARTNER_AGREEMENT"] as const;
export type PartnerLegalKind = (typeof PARTNER_LEGAL_KINDS)[number];

const minor = z.number().int().min(0).max(1_000_000_000);
const isoDay = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD");
const phone = z
  .string()
  .trim()
  .regex(/^\+?[0-9 ()-]{6,20}$/, "Enter a phone number with digits, spaces or dashes");
const email = z.string().trim().toLowerCase().email("Enter a valid email address").max(254);
const text = (min: number, max: number) => z.string().trim().min(min).max(max);

export const HEARD_FROM = ["COMMUNITY_GROUP", "FRIEND_OR_FAMILY", "SOCIAL_MEDIA", "SEARCH", "VENDOR", "OTHER"] as const;
export type HeardFrom = (typeof HEARD_FROM)[number];

export const refereeSchema = z.object({ name: text(2, 120), contact: text(5, 160), relationship: text(2, 160) });
export type RefereeInput = z.infer<typeof refereeSchema>;

export const partnerProfileSchema = z.object({
  fullName: text(2, 160),
  phone,
  city: text(1, 80),
  addressLines: z.array(text(1, 100)).min(1).max(3),
  postalCode: text(2, 16),
  spaceDescription: text(20, 1000),
});
export type PartnerProfileInput = z.infer<typeof partnerProfileSchema>;

export const partnerApplicationSchema = partnerProfileSchema.extend({
  email,
  countryCode: isoCountryCode,
  heardFrom: z.enum(HEARD_FROM),
  referee: refereeSchema,
  consent: z.literal(true, { message: "Confirm you've read how we use your details" }),
});
export type PartnerApplicationInput = z.infer<typeof partnerApplicationSchema>;

export const PARTNER_CHECK_KINDS = ["REFERRAL", "IDENTITY", "PROOF_OF_ADDRESS", "STORAGE_SPACE", "WORK_STATUS"] as const;
export type PartnerCheckKind = (typeof PARTNER_CHECK_KINDS)[number];

export const REVIEWED_CHECKS: readonly PartnerCheckKind[] = ["REFERRAL", "PROOF_OF_ADDRESS", "STORAGE_SPACE"];

export const PARTNER_CHECK_STATUSES = ["NOT_STARTED", "SUBMITTED", "ACCEPTED", "REJECTED"] as const;
export type PartnerCheckStatus = (typeof PARTNER_CHECK_STATUSES)[number];

export const PROOF_DOCUMENTS = ["UTILITY_BILL", "BANK_STATEMENT", "COUNCIL_TAX"] as const;
export type ProofDocument = (typeof PROOF_DOCUMENTS)[number];
export const PROOF_MAX_AGE_DAYS = 92;

export const proofOfAddressSchema = z.object({ documentType: z.enum(PROOF_DOCUMENTS), issuedOn: isoDay, fileId: z.string().uuid() });
export type ProofOfAddressInput = z.infer<typeof proofOfAddressSchema>;

export const storageSpaceSchema = z.object({ description: text(20, 2000), fileIds: z.array(z.string().uuid()).min(2, "Add at least two photos or a video").max(12) });
export type StorageSpaceInput = z.infer<typeof storageSpaceSchema>;

export const workStatusSchema = z.object({ declaration: z.literal(true, { message: "Confirm the declaration to continue" }), taxId: z.string().trim().max(40).optional() });
export type WorkStatusInput = z.infer<typeof workStatusSchema>;

export const reviewCheckSchema = z.object({ accept: z.boolean(), note: text(10, 1000), addressMatches: z.boolean().optional() });
export type ReviewCheckInput = z.infer<typeof reviewCheckSchema>;

export const scheduleCallSchema = z.object({ scheduledAt: z.string().datetime({ offset: true }) });
export const recordCallSchema = z.object({ outcome: text(10, 1000) });

export const signAgreementSchema = z.object({ documentId: z.string().uuid(), signature: signatureSchema });
export type SignAgreementInput = z.infer<typeof signAgreementSchema>;

export const partnerDecisionSchema = z.object({ reason: text(10, 1000) });
export const assignWarehouseSchema = z.object({ warehouseId: z.string().uuid() });
export const partnerRequirementsSchema = z.object({ requiredDepositMinor: minor, requiredInsuranceMinor: minor });
export const setTierSchema = z.object({ level: z.number().int().min(1).max(10), reason: text(10, 500) });

export const insurancePolicySchema = z
  .object({ insurer: text(2, 120), policyNumber: text(3, 60), coverMinor: z.number().int().min(1).max(10_000_000_000), startsOn: isoDay, expiresOn: isoDay, fileId: z.string().uuid() })
  .refine((policy) => policy.expiresOn > policy.startsOn, { message: "The policy must end after it starts", path: ["expiresOn"] });
export type InsurancePolicyInput = z.infer<typeof insurancePolicySchema>;

export const SECURITY_KINDS = ["DEPOSIT", "BOND"] as const;
export type SecurityKind = (typeof SECURITY_KINDS)[number];

export const recordSecuritySchema = z.object({ kind: z.enum(SECURITY_KINDS), amountMinor: z.number().int().min(1).max(10_000_000_000), reference: text(3, 120), expiresOn: isoDay.optional() });
export type RecordSecurityInput = z.infer<typeof recordSecuritySchema>;
export const releaseSecuritySchema = z.object({ note: text(5, 500) });

export const partnerTeamInviteSchema = z.object({ email });

export const statementRangeSchema = z
  .object({ from: isoDay.optional(), to: isoDay.optional() })
  .refine((range) => !range.from || !range.to || range.from <= range.to, { message: "Start on or before the end date", path: ["from"] });
export type StatementRange = z.infer<typeof statementRangeSchema>;

export const PARTNER_ENTRY_TYPES = ["RECEIVING", "FULFILMENT", "STORAGE_SHARE", "HOLDBACK", "HOLDBACK_RELEASE", "PAYOUT", "ADJUSTMENT"] as const;
export type PartnerEntryType = (typeof PARTNER_ENTRY_TYPES)[number];

export const requestPayoutSchema = z.object({ amountMinor: z.number().int().min(1).max(10_000_000_000), note: text(5, 300) });
export const payoutDecisionSchema = z.object({ approve: z.boolean(), note: text(5, 300) });

export const dispatchPhotosSchema = z.object({ fileIds: z.array(z.string().uuid()).min(1, "Add a photo of the sealed parcel").max(6) });

export const requestStockCountSchema = z.object({
  lines: z.number().int().min(1).max(50).default(10),
  dueInHours: z.number().int().min(12).max(168).default(48),
  note: z.string().trim().max(500).optional(),
});
export type RequestStockCountInput = z.infer<typeof requestStockCountSchema>;

export const submitStockCountSchema = z.object({
  videoFileId: z.string().uuid(),
  lines: z
    .array(z.object({ lineId: z.string().uuid(), countedQuantity: z.number().int().min(0).max(1_000_000) }))
    .min(1)
    .max(50),
});
export type SubmitStockCountInput = z.infer<typeof submitStockCountSchema>;
export const resolveStockCountSchema = z.object({ note: text(10, 1000), openClaims: z.boolean().default(false) });

export const createMysteryOrderSchema = z.object({ productId: z.string().uuid(), quantity: z.number().int().min(1).max(5), recipient: recipientSchema });
export type CreateMysteryOrderInput = z.infer<typeof createMysteryOrderSchema>;
export const assessMysterySchema = z.object({ passed: z.boolean(), note: text(10, 1000) });
