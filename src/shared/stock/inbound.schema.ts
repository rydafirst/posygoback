import { z } from "zod";

import { STORAGE_TIERS, type StorageTier } from "./catalogue.schema";

export const SHIPPING_MODES = ["LOOSE", "PALLET"] as const;
export type ShippingMode = (typeof SHIPPING_MODES)[number];

export const INBOUND_STATUSES = ["DRAFT", "SUBMITTED", "ARRIVED", "ON_HOLD", "RECEIVED", "DISCREPANCY", "REJECTED", "RETURN_REQUESTED", "CANCELLED"] as const;
export type InboundStatus = (typeof INBOUND_STATUSES)[number];

export const INBOUND_ACTIONS = ["SUBMIT", "CANCEL", "PAY_HOLD", "CHECK_IN", "HOLD", "RELEASE", "COMPLETE", "REJECT", "REQUEST_RETURN"] as const;
export type InboundAction = (typeof INBOUND_ACTIONS)[number];

const TRANSITIONS: Record<InboundAction, { from: readonly InboundStatus[]; to: InboundStatus | "RECEIVED_OR_DISCREPANCY" }> = {
  SUBMIT: { from: ["DRAFT"], to: "SUBMITTED" },
  CANCEL: { from: ["DRAFT", "SUBMITTED"], to: "CANCELLED" },
  PAY_HOLD: { from: ["ON_HOLD"], to: "ON_HOLD" },
  CHECK_IN: { from: ["SUBMITTED"], to: "ARRIVED" },
  HOLD: { from: ["SUBMITTED", "ARRIVED"], to: "ON_HOLD" },
  RELEASE: { from: ["ON_HOLD"], to: "ARRIVED" },
  COMPLETE: { from: ["ARRIVED"], to: "RECEIVED_OR_DISCREPANCY" },
  REJECT: { from: ["ARRIVED", "ON_HOLD"], to: "REJECTED" },
  REQUEST_RETURN: { from: ["ARRIVED", "ON_HOLD"], to: "RETURN_REQUESTED" },
};

export const VENDOR_INBOUND_ACTIONS: readonly InboundAction[] = ["SUBMIT", "CANCEL", "PAY_HOLD"];
export const EDITABLE_INBOUND_STATUSES: readonly InboundStatus[] = ["DRAFT"];
export const OPEN_INBOUND_STATUSES: readonly InboundStatus[] = ["SUBMITTED", "ARRIVED", "ON_HOLD"];

export function canApplyInboundAction(action: InboundAction, status: InboundStatus): boolean {
  return TRANSITIONS[action].from.includes(status);
}

export function inboundActionsFrom(status: InboundStatus): InboundAction[] {
  return INBOUND_ACTIONS.filter((action) => canApplyInboundAction(action, status));
}

const boxCountsSchema = z.partialRecord(z.enum(STORAGE_TIERS), z.number().int().min(0).max(500)).refine((counts) => Object.values(counts).some((count) => count > 0), "Add at least one box");
export type BoxCounts = Partial<Record<StorageTier, number>>;

export function totalBoxes(counts: BoxCounts): number {
  return Object.values(counts).reduce<number>((total, count) => total + (count ?? 0), 0);
}

export const inboundInputSchema = z
  .object({
    warehouseId: z.string().uuid().optional(),
    shippingMode: z.enum(SHIPPING_MODES),
    expectedArrivalDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    carrier: z.string().trim().min(2).max(60).optional(),
    trackingNumber: z
      .string()
      .trim()
      .regex(/^[A-Za-z0-9 -]{4,60}$/, "Use letters, numbers, spaces or dashes")
      .optional(),
    boxCounts: boxCountsSchema,
    notes: z.string().trim().max(1000).optional(),
    lines: z
      .array(z.object({ productId: z.string().uuid(), quantity: z.number().int().min(1).max(100_000) }))
      .min(1, "Add at least one product")
      .max(200),
  })
  .superRefine((inbound, context) => {
    const ids = inbound.lines.map((line) => line.productId);
    if (new Set(ids).size !== ids.length) {
      context.addIssue({ code: "custom", path: ["lines"], message: "Each product can only appear once" });
    }
    const pallets = inbound.boxCounts.PALLET ?? 0;
    if (inbound.shippingMode === "PALLET" && pallets === 0) {
      context.addIssue({ code: "custom", path: ["boxCounts"], message: "Add the number of pallets" });
    }
    if (inbound.shippingMode === "LOOSE" && pallets > 0) {
      context.addIssue({ code: "custom", path: ["boxCounts"], message: "Choose pallet shipping to send pallets" });
    }
  });
export type InboundInput = z.infer<typeof inboundInputSchema>;

export function arrivalDateProblem(date: string, today: string): string | null {
  const horizon = new Date(`${today}T00:00:00Z`);
  horizon.setUTCDate(horizon.getUTCDate() + 180);
  if (date < today) {
    return "Choose today or a later date";
  }
  return date > horizon.toISOString().slice(0, 10) ? "Choose a date within the next six months" : null;
}

export const inboundReasonSchema = z.object({ reason: z.string().trim().min(10).max(1000) });

export const HOLD_CHARGE_LIMITS = { minMinor: 50, maxMinor: 5_000_000 } as const;

export const inboundEstimateSchema = z.object({ shippingMode: z.enum(SHIPPING_MODES), boxCounts: z.partialRecord(z.enum(STORAGE_TIERS), z.number().int().min(0).max(500)) });
export type InboundEstimateInput = z.infer<typeof inboundEstimateSchema>;

export interface InboundEstimateView {
  currency: string;
  firstShipment: boolean;
  stockingMinor: number;
  storageMinor: number;
  waivedMinor: number;
  totalMinor: number;
}
export type InboundReasonInput = z.infer<typeof inboundReasonSchema>;

export const inboundMessageSchema = z.object({ body: z.string().trim().min(1).max(2000) });
export type InboundMessageInput = z.infer<typeof inboundMessageSchema>;

export const receiveInboundSchema = z
  .object({
    boxCounts: z.partialRecord(z.enum(STORAGE_TIERS), z.number().int().min(0).max(500)),
    photoFileIds: z.array(z.string().uuid()).min(1, "Add at least one photo of the shipment").max(30),
    lines: z
      .array(
        z.object({
          lineId: z.string().uuid(),
          acceptedQuantity: z.number().int().min(0).max(100_000),
          damagedQuantity: z.number().int().min(0).max(100_000),
          damagePhotoFileIds: z.array(z.string().uuid()).max(10).default([]),
          note: z.string().trim().max(500).optional(),
        }),
      )
      .min(1)
      .max(200),
    note: z.string().trim().max(1000).optional(),
  })
  .superRefine((input, context) => {
    input.lines.forEach((line, index) => {
      if (line.damagedQuantity > 0 && line.damagePhotoFileIds.length === 0) {
        context.addIssue({ code: "custom", path: ["lines", index, "damagePhotoFileIds"], message: "Photograph the damaged units" });
      }
    });
    const ids = input.lines.map((line) => line.lineId);
    if (new Set(ids).size !== ids.length) {
      context.addIssue({ code: "custom", path: ["lines"], message: "Each line can only be counted once" });
    }
  });
export type ReceiveInboundInput = z.infer<typeof receiveInboundSchema>;

export interface InboundLineView {
  id: string;
  productId: string;
  productCode: string;
  productName: string;
  declaredQuantity: number;
  acceptedQuantity: number;
  damagedQuantity: number;
  missingQuantity: number;
  extraQuantity: number;
  note: string | null;
}

export interface InboundSummaryView {
  id: string;
  reference: string;
  vendorId: string;
  businessName: string;
  warehouseId: string;
  warehouseName: string;
  countryCode: string;
  status: InboundStatus;
  shippingMode: ShippingMode;
  expectedArrivalDate: string;
  totalUnits: number;
  totalBoxes: number;
  submittedAt: string | null;
  updatedAt: string;
}

export interface InboundPhotoView {
  fileId: string;
  lineId: string | null;
}

export interface InboundMessageView {
  id: string;
  fromPlatform: boolean;
  authorEmail: string | null;
  body: string;
  createdAt: string;
}

export interface InboundChargesView {
  currency: string;
  onboardingFeeMinor: number | null;
  onboardingChargedAt: string | null;
  holdChargeMinor: number | null;
  holdPaidAt: string | null;
}

export interface InboundDetailView extends InboundSummaryView {
  charges: InboundChargesView;
  carrier: string | null;
  trackingNumber: string | null;
  notes: string | null;
  declaredBoxCounts: BoxCounts;
  receivedBoxCounts: BoxCounts | null;
  statusReason: string | null;
  receivingNote: string | null;
  arrivedAt: string | null;
  receivedAt: string | null;
  lines: InboundLineView[];
  photos: InboundPhotoView[];
  messages: InboundMessageView[];
  actions: InboundAction[];
}
