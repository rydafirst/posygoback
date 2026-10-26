import { z } from "zod";

export const buyerLinkSchema = z.object({ email: z.string().trim().toLowerCase().email("Enter a valid email address").max(254) });
export type BuyerLinkInput = z.infer<typeof buyerLinkSchema>;

export const buyerSessionSchema = z.object({ token: z.string().regex(/^[A-Za-z0-9_-]{43}$/, "This sign-in link isn't valid") });
export type BuyerSessionInput = z.infer<typeof buyerSessionSchema>;

export const returnRequestSchema = z.object({ reason: z.string().trim().min(10, "Tell the store a little more, at least 10 characters").max(1000) });
export type ReturnRequestInput = z.infer<typeof returnRequestSchema>;

export const returnDecisionSchema = z
  .object({ accept: z.boolean(), refundMinor: z.number().int().min(1).max(100_000_000).optional(), note: z.string().trim().min(3, "Add a short note for the buyer").max(1000) })
  .refine((input) => !input.accept || input.refundMinor !== undefined, { message: "Enter how much to refund", path: ["refundMinor"] });
export type ReturnDecisionInput = z.infer<typeof returnDecisionSchema>;

export const STOREFRONT_RETURN_STATUSES = ["REQUESTED", "APPROVED", "REJECTED", "REFUNDED"] as const;
export type StorefrontReturnStatus = (typeof STOREFRONT_RETURN_STATUSES)[number];
