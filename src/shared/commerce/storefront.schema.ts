import { z } from "zod";

import { recipientSchema } from "../orders/recipient";

export const STOREFRONT_TONES = ["lime", "sky", "yellow", "pink", "orange", "teal", "blue", "magenta", "cocoa"] as const;
export type StorefrontTone = (typeof STOREFRONT_TONES)[number];

export const STOREFRONT_STATUSES = ["DRAFT", "LIVE", "PAUSED"] as const;
export type StorefrontStatus = (typeof STOREFRONT_STATUSES)[number];

export const RESERVED_SLUGS = ["admin", "api", "app", "account", "cart", "checkout", "help", "login", "marketplace", "orders", "partners", "store", "stores", "support", "track", "www"] as const;

export const storefrontSlugSchema = z
  .string()
  .trim()
  .toLowerCase()
  .min(3, "Use at least 3 characters")
  .max(40, "Use at most 40 characters")
  .regex(/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])$/, "Use lowercase letters, numbers and hyphens")
  .refine((slug) => !(RESERVED_SLUGS as readonly string[]).includes(slug), "That address is reserved");

export const storefrontSettingsSchema = z.object({
  slug: storefrontSlugSchema,
  displayName: z.string().trim().min(2).max(80),
  about: z.string().trim().max(2000).optional(),
  tone: z.enum(STOREFRONT_TONES),
  returnsAllowed: z.boolean(),
  returnWindowDays: z.number().int().min(1).max(365),
});
export type StorefrontSettingsInput = z.infer<typeof storefrontSettingsSchema>;

export const productListingSchema = z
  .object({
    listed: z.boolean(),
    retailPriceMinor: z.number().int().min(1).max(100_000_000).optional(),
    description: z.string().trim().max(2000).optional(),
    category: z.string().trim().min(2).max(60).optional(),
  })
  .refine((input) => !input.listed || input.retailPriceMinor !== undefined, { message: "Set a price before listing this product", path: ["retailPriceMinor"] });
export type ProductListingInput = z.infer<typeof productListingSchema>;

export const DELIVERY_SPEEDS = ["STANDARD", "EXPRESS"] as const;
export type DeliverySpeed = (typeof DELIVERY_SPEEDS)[number];

const cartItemsSchema = z
  .array(z.object({ productId: z.string().uuid(), quantity: z.number().int().min(1).max(99) }))
  .min(1, "Your basket is empty")
  .max(30)
  .refine((items) => new Set(items.map((item) => item.productId)).size === items.length, "Each product appears once");

export const shipToSchema = recipientSchema.omit({ company: true, email: true });
export type ShipTo = z.infer<typeof shipToSchema>;

export const quoteSchema = z.object({ items: cartItemsSchema, shipTo: shipToSchema, discountCode: z.string().trim().toUpperCase().max(40).optional() });
export type QuoteInput = z.infer<typeof quoteSchema>;

export const checkoutSchema = quoteSchema.extend({
  buyerEmail: z.string().trim().toLowerCase().email("Enter a valid email address").max(254),
  buyerName: z.string().trim().min(2).max(120),
  deliverySpeed: z.enum(DELIVERY_SPEEDS),
});
export type CheckoutInput = z.infer<typeof checkoutSchema>;

export const STOREFRONT_ORDER_STATUSES = ["PENDING_PAYMENT", "PAID", "AWAITING_VENDOR_FUNDS", "FULFILLING", "SHIPPED", "DELIVERED", "CANCELLED", "REFUNDED", "PAYMENT_FAILED"] as const;
export type StorefrontOrderStatus = (typeof STOREFRONT_ORDER_STATUSES)[number];

export const VENDOR_PAYOUT_STATUSES = ["NONE", "HELD", "PENDING", "PAID", "FAILED", "CANCELLED"] as const;
export type VendorPayoutStatus = (typeof VENDOR_PAYOUT_STATUSES)[number];
