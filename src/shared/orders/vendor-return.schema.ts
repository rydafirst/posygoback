import { z } from "zod";

export const RETURN_RULES = { windowDays: 90, receiveDays: 45, instructionDays: 14, maxPhotos: 10 } as const;

export const VENDOR_RETURN_STATUSES = ["REQUESTED", "RECEIVED", "INSTRUCTED", "COMPLETED", "CANCELLED", "EXPIRED"] as const;
export type VendorReturnStatus = (typeof VENDOR_RETURN_STATUSES)[number];

const uniqueLines = <T extends { lineId: string }>(lines: T[]) => new Set(lines.map((line) => line.lineId)).size === lines.length;
const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .optional()
    .transform((value) => value || undefined);

export const createVendorReturnSchema = z.object({
  orderId: z.string().uuid(),
  reason: z.string().trim().min(5, "Say briefly why it's coming back").max(500),
  carrier: optionalText(60),
  trackingNumber: optionalText(64),
  lines: z
    .array(z.object({ lineId: z.string().uuid(), quantity: z.number().int().min(1).max(9999) }))
    .min(1, "Choose at least one item")
    .max(50)
    .refine(uniqueLines, "Each item appears once"),
});
export type CreateVendorReturnInput = z.infer<typeof createVendorReturnSchema>;

export const vendorReturnTrackingSchema = z.object({ carrier: z.string().trim().min(2).max(60), trackingNumber: z.string().trim().min(4).max(64) });
export type VendorReturnTrackingInput = z.infer<typeof vendorReturnTrackingSchema>;

export const receiveVendorReturnSchema = z.object({
  lines: z
    .array(z.object({ lineId: z.string().uuid(), receivedQuantity: z.number().int().min(0).max(9999) }))
    .min(1)
    .max(50)
    .refine(uniqueLines, "Each item appears once"),
  notes: optionalText(1000),
  photoFileIds: z.array(z.string().uuid()).min(1, "Add at least one photo of what arrived").max(RETURN_RULES.maxPhotos),
});
export type ReceiveVendorReturnInput = z.infer<typeof receiveVendorReturnSchema>;

export const instructVendorReturnSchema = z.object({
  lines: z
    .array(z.object({ lineId: z.string().uuid(), restock: z.number().int().min(0).max(9999), dispose: z.number().int().min(0).max(9999), donate: z.number().int().min(0).max(9999) }))
    .min(1)
    .max(50)
    .refine(uniqueLines, "Each item appears once"),
});
export type InstructVendorReturnInput = z.infer<typeof instructVendorReturnSchema>;

export interface VendorReturnLineView {
  id: string;
  orderLineId: string;
  productName: string;
  productCode: string;
  requestedQuantity: number;
  receivedQuantity: number | null;
  restockQuantity: number;
  disposeQuantity: number;
  donateQuantity: number;
}

export interface ReturnAddressView {
  name: string;
  addressLines: string[];
  city: string;
  postalCode: string;
}

export interface VendorReturnView {
  id: string;
  reference: string;
  status: VendorReturnStatus;
  orderId: string;
  orderReference: string;
  vendorName: string | null;
  warehouseName: string;
  returnAddress: ReturnAddressView | null;
  reason: string;
  carrier: string | null;
  trackingNumber: string | null;
  feeMinor: number;
  currency: string;
  createdAt: string;
  receiveBy: string;
  receivedAt: string | null;
  receiveNotes: string | null;
  photoFileIds: string[];
  instructBy: string | null;
  instructedAt: string | null;
  completedAt: string | null;
  lines: VendorReturnLineView[];
}

export interface ReturnableLineView {
  lineId: string;
  productName: string;
  productCode: string;
  shippedQuantity: number;
  returnableQuantity: number;
}

export interface ReturnableOrderView {
  orderId: string;
  orderReference: string;
  returnableUntil: string;
  feeMinor: number;
  currency: string;
  lines: ReturnableLineView[];
}
