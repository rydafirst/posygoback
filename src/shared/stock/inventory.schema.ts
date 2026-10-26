import { z } from "zod";

import type { StorageTier } from "./catalogue.schema";

export const LOT_CONDITIONS = ["SELLABLE", "DAMAGED"] as const;
export type LotCondition = (typeof LOT_CONDITIONS)[number];

export const MOVEMENT_TYPES = ["RECEIVE", "PUT_AWAY", "MOVE", "RESERVE", "RELEASE", "SHIP", "ADJUST", "TRANSFER_OUT", "TRANSFER_IN", "WRITE_OFF", "RETURN_IN"] as const;
export type MovementType = (typeof MOVEMENT_TYPES)[number];

export const CUSTODY_EVENT_TYPES = ["RECEIVED", "PUT_AWAY", "MOVED", "PICKED", "PACKED", "HANDED_OFF", "RELEASED", "TRANSFERRED_OUT", "TRANSFERRED_IN", "WRITTEN_OFF", "RETURNED"] as const;
export type CustodyEventType = (typeof CUSTODY_EVENT_TYPES)[number];

export const warehouseInputSchema = z.object({
  countryCode: z.string().regex(/^[A-Z]{2}$/),
  code: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z0-9-]{2,16}$/, "Use 2–16 letters, numbers or dashes"),
  name: z.string().trim().min(2).max(80),
  addressLines: z.array(z.string().trim().min(1).max(120)).min(1).max(4),
  city: z.string().trim().min(1).max(80),
  postalCode: z.string().trim().min(2).max(16),
});
export type WarehouseInput = z.infer<typeof warehouseInputSchema>;

export const locationInputSchema = z.object({
  code: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z0-9-]{1,32}$/, "Use letters, numbers or dashes"),
  label: z.string().trim().min(1).max(80),
});
export type LocationInput = z.infer<typeof locationInputSchema>;

export const placeLotSchema = z.object({ locationId: z.string().uuid() });
export type PlaceLotInput = z.infer<typeof placeLotSchema>;

export interface WarehouseView {
  id: string;
  countryCode: string;
  code: string;
  name: string;
  addressLines: string[];
  city: string;
  postalCode: string;
  active: boolean;
  partnerId: string | null;
}

export interface LocationView {
  id: string;
  warehouseId: string;
  code: string;
  label: string;
  active: boolean;
  lotCount: number;
}

export interface LotView {
  id: string;
  code: string;
  productId: string;
  productCode: string;
  productName: string;
  vendorId: string;
  businessName: string;
  warehouseId: string;
  condition: LotCondition;
  storageTier: StorageTier;
  quantityAvailable: number;
  quantityReserved: number;
  locationCode: string | null;
  inboundReference: string;
  receivedAt: string;
}

export interface MovementView {
  id: string;
  type: MovementType;
  lotCode: string;
  productCode: string;
  deltaAvailable: number;
  deltaReserved: number;
  reason: string | null;
  createdAt: string;
}

export interface CustodyEventView {
  id: string;
  sequence: number;
  type: CustodyEventType;
  lotCode: string;
  fromLocation: string | null;
  toLocation: string | null;
  quantity: number;
  actorEmail: string | null;
  createdAt: string;
}

export interface LabelView {
  code: string;
  productName: string;
  variantLabel: string | null;
  quantity: number | null;
  barcode: string;
}
