import { z } from "zod";

export const SIGNATURE_METHODS = ["DRAWN", "TYPED"] as const;
export type SignatureMethod = (typeof SIGNATURE_METHODS)[number];

export const SIGNATURE_IMAGE_MAX = 80_000;

export const signatureSchema = z.object({
  method: z.enum(SIGNATURE_METHODS),
  name: z.string().trim().min(2, "Enter your full name").max(160),
  image: z
    .string()
    .max(SIGNATURE_IMAGE_MAX, "That signature is too large")
    .regex(/^data:image\/png;base64,[A-Za-z0-9+/]+={0,2}$/, "Sign again"),
  consent: z.literal(true, { message: "Confirm you agree to sign electronically" }),
});
export type SignatureInput = z.infer<typeof signatureSchema>;

export const acceptAgreementSchema = z.object({ signature: signatureSchema.optional() }).default({});
export type AcceptAgreementInput = z.infer<typeof acceptAgreementSchema>;

export interface SignatureCertificateView {
  reference: string;
  documentTitle: string;
  documentVersion: string;
  documentSha256: string;
  signerName: string;
  signerEmail: string;
  method: SignatureMethod;
  image: string;
  signedAt: string;
  ip: string | null;
}
