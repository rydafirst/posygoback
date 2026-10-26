import { z } from "zod";

export const DISCOUNT_KINDS = ["PERCENT", "FIXED"] as const;
export type DiscountKind = (typeof DISCOUNT_KINDS)[number];

const discountWindow = <T extends { startsAt?: string; endsAt?: string }>(input: T) => !input.startsAt || !input.endsAt || new Date(input.endsAt) > new Date(input.startsAt);

export const discountCodeSchema = z
  .object({
    code: z
      .string()
      .trim()
      .toUpperCase()
      .regex(/^[A-Z0-9][A-Z0-9-]{2,39}$/, "Use 3 to 40 letters, numbers and hyphens"),
    kind: z.enum(DISCOUNT_KINDS),
    percentBps: z.number().int().min(100, "At least 1%").max(9000, "At most 90%").optional(),
    amountMinor: z.number().int().min(1).max(100_000_000).optional(),
    minGoodsMinor: z.number().int().min(0).max(100_000_000).default(0),
    startsAt: z.string().datetime().optional(),
    endsAt: z.string().datetime().optional(),
    maxRedemptions: z.number().int().min(1).max(1_000_000).optional(),
  })
  .refine((input) => (input.kind === "PERCENT" ? input.percentBps !== undefined && input.amountMinor === undefined : input.amountMinor !== undefined && input.percentBps === undefined), {
    message: "Enter the discount amount",
    path: ["value"],
  })
  .refine(discountWindow, { message: "The end must be after the start", path: ["endsAt"] });
export type DiscountCodeInput = z.infer<typeof discountCodeSchema>;

export const discountUpdateSchema = z.object({ active: z.boolean() });
export type DiscountUpdateInput = z.infer<typeof discountUpdateSchema>;
