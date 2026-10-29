import { z } from "zod";

import type { OrderAction, OrderStatus, PublicTrackingStatus, TrackingStatus } from "./order-lifecycle";
import { DELIVERY_PREFERENCES, type DeliveryPreference, type RateTag } from "./delivery-preference";
import { orderRecipientSchema, type Recipient } from "./recipient";

export const ORDER_SOURCES = ["PORTAL", "CSV", "API", "STOREFRONT"] as const;
export type OrderSource = (typeof ORDER_SOURCES)[number];

export const externalReferenceSchema = z
  .string()
  .trim()
  .regex(/^[A-Za-z0-9._:#/-]{1,64}$/, "Use up to 64 letters, numbers or . _ : # / -");

const orderLineSchema = z.object({ productId: z.string().uuid(), quantity: z.number().int().min(1).max(1000) });

function uniqueProducts<T extends { lines: Array<{ productId: string }> }>(delivery: T, context: z.RefinementCtx) {
  const ids = delivery.lines.map((line) => line.productId);
  if (new Set(ids).size !== ids.length) {
    context.addIssue({ code: "custom", path: ["lines"], message: "Each product can only appear once" });
  }
}

export const deliverySchema = z
  .object({
    externalReference: externalReferenceSchema.optional(),
    recipient: orderRecipientSchema,
    lines: z.array(orderLineSchema).min(1, "Add at least one product").max(50),
    deliveryPreference: z.enum(DELIVERY_PREFERENCES).optional(),
    preferredService: z.string().trim().min(3).max(200).optional(),
  })
  .superRefine(uniqueProducts);
export type DeliveryInput = z.infer<typeof deliverySchema>;

export const createOrdersSchema = z.object({ warehouseId: z.string().uuid().optional(), deliveries: z.array(deliverySchema).min(1).max(20) }).superRefine((input, context) => {
  const references = input.deliveries.map((delivery) => delivery.externalReference).filter(Boolean);
  if (new Set(references).size !== references.length) {
    context.addIssue({ code: "custom", path: ["deliveries"], message: "Each delivery needs its own reference" });
  }
});
export type CreateOrdersInput = z.infer<typeof createOrdersSchema>;

export const shippingEstimateSchema = z.object({
  recipient: orderRecipientSchema,
  lines: z.array(orderLineSchema).min(1).max(50),
  deliveryPreference: z.enum(DELIVERY_PREFERENCES).optional(),
});
export type ShippingEstimateInput = z.infer<typeof shippingEstimateSchema>;

export interface ShippingEstimateRateView {
  id: string;
  carrier: string;
  service: string;
  chargeMinor: number;
  estimatedDays: number | null;
  tags: RateTag[];
  preferred: boolean;
}

export interface ShippingEstimateView {
  currency: string;
  boxLabel: string;
  sized: boolean;
  productsWithoutSize: string[];
  rates: ShippingEstimateRateView[];
}

export const CANCELLATION_REASONS = ["CUSTOMER_CANCELLED", "WRONG_ITEMS", "ADDRESS_PROBLEM", "OUT_OF_STOCK", "OTHER"] as const;
export type CancellationReason = (typeof CANCELLATION_REASONS)[number];

export const vendorOrderActionSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("CANCEL"), reason: z.enum(CANCELLATION_REASONS), note: z.string().trim().max(500).optional() }),
  z.object({ action: z.literal("REQUEST_CANCELLATION"), reason: z.enum(CANCELLATION_REASONS), note: z.string().trim().max(500).optional() }),
  z.object({ action: z.literal("PAY_SHIPPING") }),
]);
export type VendorOrderActionInput = z.infer<typeof vendorOrderActionSchema>;

export const PACK_LIMITS = { maxSideMm: 2000, maxWeightGrams: 70_000 } as const;

const side = z.number().int().min(1).max(PACK_LIMITS.maxSideMm);

export const packSchema = z
  .object({
    presetId: z.string().uuid().optional(),
    dimensions: z.object({ lengthMm: side, widthMm: side, heightMm: side }).optional(),
    weightGrams: z.number().int().min(1).max(PACK_LIMITS.maxWeightGrams),
    notes: z.string().trim().max(500).optional(),
  })
  .refine((pack) => Boolean(pack.presetId) !== Boolean(pack.dimensions), { message: "Choose a package or enter its size", path: ["presetId"] });
export type PackInput = z.infer<typeof packSchema>;

export const scanSchema = z.object({ code: z.string().trim().min(1).max(64) });

export const staffOrderActionSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("REPACK") }),
  z.object({ action: z.literal("FETCH_RATES") }),
  z.object({ action: z.literal("SELECT_RATE"), rateId: z.string().uuid() }),
  z.object({ action: z.literal("RETRY_LABEL") }),
  z.object({ action: z.literal("HAND_OFF"), photoFileIds: z.array(z.string().uuid()).max(6).default([]), sealNumber: z.string().trim().min(3).max(40).optional() }),
  z.object({ action: z.literal("HOLD"), reason: z.string().trim().min(10).max(500) }),
  z.object({ action: z.literal("RELEASE") }),
  z.object({ action: z.literal("CANCEL"), reason: z.enum(CANCELLATION_REASONS), note: z.string().trim().min(10).max(500) }),
]);
export type StaffOrderActionInput = z.infer<typeof staffOrderActionSchema>;

export const cancellationDecisionSchema = z.object({ approve: z.boolean(), note: z.string().trim().min(10).max(500) });
export type CancellationDecisionInput = z.infer<typeof cancellationDecisionSchema>;

export const PACKAGING_KINDS = ["BOX", "MAILER"] as const;
export type PackagingKind = (typeof PACKAGING_KINDS)[number];

export const packagingPresetSchema = z.object({
  code: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z0-9-]{2,24}$/, "Use 2–24 letters, numbers or dashes"),
  label: z.string().trim().min(2).max(60),
  kind: z.enum(PACKAGING_KINDS),
  lengthMm: side,
  widthMm: side,
  heightMm: side,
  active: z.boolean().default(true),
});
export type PackagingPresetInput = z.infer<typeof packagingPresetSchema>;

export interface PackagingPresetView extends PackagingPresetInput {
  id: string;
  countryCode: string;
}

export interface OrderSummaryView {
  id: string;
  reference: string;
  externalReference: string | null;
  businessName: string;
  status: OrderStatus;
  source: OrderSource;
  warehouseName: string;
  countryCode: string;
  recipientName: string;
  recipientCity: string;
  totalUnits: number;
  carrier: string | null;
  trackingNumber: string | null;
  createdAt: string;
  cancellationPending: boolean;
  deliveryPreference: DeliveryPreference;
  preferredService: string | null;
}

export interface OrderLineView {
  id: string;
  productId: string;
  productCode: string;
  productName: string;
  quantity: number;
  scannedQuantity: number;
  unitValueMinor: number;
  locations: string[];
  barcodes: string[];
}

export interface OrderChargesView {
  currency: string;
  fulfilmentFeeMinor: number;
  shippingChargeMinor: number | null;
  refundedMinor: number;
}

export interface OrderPackView {
  presetLabel: string | null;
  lengthMm: number;
  widthMm: number;
  heightMm: number;
  weightGrams: number;
  notes: string | null;
  packedAt: string;
}

export interface RateView {
  id: string;
  carrier: string;
  service: string;
  chargeMinor: number | null;
  currency: string;
  estimatedDays: number | null;
  selected: boolean;
  tags: RateTag[];
  preferred: boolean;
}

export interface OrderLabelView {
  carrier: string;
  service: string;
  trackingNumber: string;
  labelUrl: string | null;
  trackingUrl: string | null;
  purchasedAt: string;
  voidRequestedAt: string | null;
}

export interface OrderEventView {
  id: string;
  type: string;
  description: string;
  source: "VENDOR" | "STAFF" | "SYSTEM" | "CARRIER";
  occurredAt: string;
}

export interface CancellationRequestView {
  id: string;
  status: "PENDING" | "APPROVED" | "REJECTED";
  reason: CancellationReason;
  note: string | null;
  requestedAt: string;
  decisionNote: string | null;
}

export interface OrderDetailView extends OrderSummaryView {
  recipient: Recipient;
  holdReason: string | null;
  lines: OrderLineView[];
  charges: OrderChargesView | null;
  pack: OrderPackView | null;
  rates: RateView[];
  label: OrderLabelView | null;
  events: OrderEventView[];
  cancellation: CancellationRequestView | null;
  dispatchPhotoCount: number;
  sealRequired: boolean;
  sealNumber: string | null;
  actions: OrderAction[];
}

export interface OrderEstimateView {
  currency: string;
  fulfilmentFeeMinor: number;
  balanceMinor: number;
}

export interface ScanResultView {
  lineId: string;
  productName: string;
  scannedQuantity: number;
  quantity: number;
  complete: boolean;
}

export interface PublicTrackingView {
  reference: string;
  status: PublicTrackingStatus;
  carrier: string | null;
  trackingNumber: string | null;
  trackingUrl: string | null;
  destination: { city: string; countryCode: string };
  events: Array<{ description: string; occurredAt: string; location: string | null }>;
}

export interface CarrierTrackingEvent {
  status: TrackingStatus;
  description: string;
  occurredAt: string;
  location: string | null;
}

export function unitsOf(lines: ReadonlyArray<{ quantity: number }>): number {
  return lines.reduce((total, line) => total + line.quantity, 0);
}

export function orderValueMinor(lines: ReadonlyArray<{ quantity: number; unitValueMinor: number }>): number {
  return lines.reduce((total, line) => total + line.quantity * line.unitValueMinor, 0);
}
