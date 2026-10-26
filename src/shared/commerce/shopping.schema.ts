import { z } from "zod";

import { DELIVERY_SPEEDS, type DeliverySpeed, type ShipTo, shipToSchema } from "./storefront.schema";

export const SHOPPING_RULES = { maxLines: 15, quoteValidDays: 7, maxPhotos: 10, packingAllowanceGrams: 300 } as const;

export const SHOPPING_STATUSES = ["REQUESTED", "QUOTED", "PAID", "BUYING", "ARRIVED", "SHIPPED", "DELIVERED", "CANCELLED", "EXPIRED"] as const;
export type ShoppingStatus = (typeof SHOPPING_STATUSES)[number];

export const SHOPPING_LINE_STATUSES = ["REQUESTED", "QUOTED", "UNAVAILABLE", "BOUGHT", "OUT_OF_STOCK", "RECEIVED"] as const;
export type ShoppingLineStatus = (typeof SHOPPING_LINE_STATUSES)[number];

const lineId = z.string().uuid();
const uniqueLines = <T extends { lineId: string }>(lines: T[]) => new Set(lines.map((line) => line.lineId)).size === lines.length;

export const shoppingRequestSchema = z.object({
  countryCode: z.string().regex(/^[A-Z]{2}$/),
  buyerEmail: z.string().trim().toLowerCase().email("Enter a valid email address").max(254),
  buyerName: z.string().trim().min(2, "Enter your name").max(120),
  shipTo: shipToSchema,
  notes: z.string().trim().max(1000).optional(),
  lines: z
    .array(
      z.object({
        url: z
          .string()
          .trim()
          .max(2000)
          .url("Paste the full link to the item")
          .refine((value) => value.startsWith("https://"), "Use a secure link starting with https://"),
        description: z.string().trim().min(3, "Say what you want: size, colour, model").max(300),
        quantity: z.number().int().min(1).max(99),
      }),
    )
    .min(1, "Add at least one item")
    .max(SHOPPING_RULES.maxLines, `Up to ${SHOPPING_RULES.maxLines} items per request`),
});
export type ShoppingRequestInput = z.infer<typeof shoppingRequestSchema>;

export const shoppingQuoteSchema = z.object({
  warehouseId: z.string().uuid(),
  packagingPresetId: z.string().uuid(),
  lines: z
    .array(
      z.object({
        lineId,
        available: z.boolean(),
        unitPriceMinor: z.number().int().min(1).max(100_000_000).optional(),
        unitWeightGrams: z.number().int().min(1).max(50_000).optional(),
        hsCode: z
          .string()
          .trim()
          .regex(/^\d{6,10}$/, "Use 6 to 10 digits")
          .optional(),
        staffNote: z.string().trim().max(300).optional(),
      }),
    )
    .min(1)
    .max(SHOPPING_RULES.maxLines)
    .refine(uniqueLines, "Each item appears once")
    .refine((lines) => lines.every((line) => !line.available || (line.unitPriceMinor !== undefined && line.unitWeightGrams !== undefined)), "Give a price and a weight for every item we can get")
    .refine((lines) => lines.some((line) => line.available), "At least one item must be available to quote"),
});
export type ShoppingQuoteInput = z.infer<typeof shoppingQuoteSchema>;

export const shoppingCheckoutSchema = z.object({ deliverySpeed: z.enum(DELIVERY_SPEEDS) });
export type ShoppingCheckoutInput = z.infer<typeof shoppingCheckoutSchema>;

export const shoppingPurchaseSchema = z.object({
  lines: z
    .array(z.object({ lineId, bought: z.boolean(), retailerOrderRef: z.string().trim().max(80).optional() }))
    .min(1)
    .max(SHOPPING_RULES.maxLines)
    .refine(uniqueLines, "Each item appears once"),
});
export type ShoppingPurchaseInput = z.infer<typeof shoppingPurchaseSchema>;

export const shoppingArrivalSchema = z.object({
  lines: z
    .array(z.object({ lineId, receivedQuantity: z.number().int().min(0).max(99) }))
    .min(1)
    .max(SHOPPING_RULES.maxLines)
    .refine(uniqueLines, "Each item appears once"),
  photoFileIds: z.array(z.string().uuid()).min(1, "Add at least one photo of what arrived").max(SHOPPING_RULES.maxPhotos),
});
export type ShoppingArrivalInput = z.infer<typeof shoppingArrivalSchema>;

export const shoppingConfirmSchema = z.object({ token: z.string().regex(/^[A-Za-z0-9_-]{43}$/) });
export type ShoppingConfirmInput = z.infer<typeof shoppingConfirmSchema>;

export const shoppingCancelSchema = z.object({ reason: z.string().trim().min(5, "Say briefly why").max(300) });
export type ShoppingCancelInput = z.infer<typeof shoppingCancelSchema>;

export interface ShoppingLineView {
  id: string;
  url: string;
  description: string;
  quantity: number;
  status: ShoppingLineStatus;
  unitPriceMinor: number | null;
  unitWeightGrams: number | null;
  hsCode: string | null;
  staffNote: string | null;
  retailerOrderRef: string | null;
  receivedQuantity: number | null;
}

export interface ShoppingDeliveryOptionView {
  speed: DeliverySpeed;
  label: string;
  window: string;
  priceMinor: number;
}

export interface ShoppingRequestView {
  id: string;
  reference: string;
  countryCode: string;
  currency: string;
  status: ShoppingStatus;
  buyerName: string;
  buyerEmail: string | null;
  recipientCity: string;
  destinationCountryCode: string;
  shipTo: ShipTo | null;
  notes: string | null;
  confirmed: boolean;
  disputeOpen: boolean;
  lines: ShoppingLineView[];
  goodsMinor: number;
  commissionMinor: number;
  deliveryMinor: number;
  totalMinor: number;
  refundedMinor: number;
  deliveryOptions: ShoppingDeliveryOptionView[];
  quoteExpiresAt: string | null;
  warehouseName: string | null;
  arrivalPhotoFileIds: string[];
  carrier: string | null;
  trackingNumber: string | null;
  trackingUrl: string | null;
  cancelReason: string | null;
  createdAt: string;
  paidAt: string | null;
  shippedAt: string | null;
}

export interface ShoppingStartedView {
  reference: string;
  redirectUrl: string;
}
