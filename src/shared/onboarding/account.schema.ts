import { z } from "zod";

import { emailSchema, passwordSchema } from "../auth/auth.schema";

export const LEGAL_DOCUMENT_KINDS = ["VENDOR_AGREEMENT", "TERMS", "PRIVACY", "PARTNER_AGREEMENT", "CUSTODY_TERMS", "NON_DIVERSION", "DATA_PROCESSING", "INSURANCE_OBLIGATION"] as const;
export type LegalDocumentKind = (typeof LEGAL_DOCUMENT_KINDS)[number];
export const VENDOR_LEGAL_KINDS: readonly LegalDocumentKind[] = ["VENDOR_AGREEMENT", "TERMS", "PRIVACY"];

export const createLegalDocumentSchema = z.object({
  countryCode: z.string().regex(/^[A-Z]{2}$/),
  kind: z.enum(LEGAL_DOCUMENT_KINDS),
  version: z
    .string()
    .trim()
    .regex(/^[0-9A-Za-z.-]{1,32}$/, "Use letters, numbers, dots or dashes"),
  title: z.string().trim().min(3).max(160),
  body: z.string().trim().min(50).max(100_000),
});
export type CreateLegalDocumentInput = z.infer<typeof createLegalDocumentSchema>;

export interface LegalDocumentView {
  id: string;
  countryCode: string;
  kind: LegalDocumentKind;
  version: string;
  title: string;
  body: string;
  publishedAt: string;
}

export interface RequiredAgreementView {
  document: LegalDocumentView;
  acceptedAt: string | null;
}

export const inviteMemberSchema = z.object({ email: emailSchema });
export type InviteMemberInput = z.infer<typeof inviteMemberSchema>;

export const invitationTokenSchema = z.object({ token: z.string().min(32).max(200) });
export const acceptInvitationSchema = z.object({ token: z.string().min(32).max(200), password: passwordSchema });
export type AcceptInvitationInput = z.infer<typeof acceptInvitationSchema>;

export interface TeamMemberView {
  userId: string;
  email: string;
  role: "VENDOR_OWNER" | "VENDOR_MEMBER";
  status: string;
  joinedAt: string;
}

export interface TeamInvitationView {
  id: string;
  email: string;
  status: "PENDING" | "ACCEPTED" | "REVOKED" | "EXPIRED";
  expiresAt: string;
}

export interface TeamView {
  members: TeamMemberView[];
  invitations: TeamInvitationView[];
}

export interface InvitationPreview {
  businessName: string;
  email: string;
}
