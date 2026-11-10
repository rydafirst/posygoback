import { z } from "zod";

import { STORAGE_TIERS, type StorageTier } from "./catalogue.schema";
import type { BoxCounts } from "./inbound.schema";

export const BOX_CLOSE_REASONS = ["EMPTY", "REPACKED"] as const;
export type BoxCloseReason = (typeof BOX_CLOSE_REASONS)[number];

export const REPACK_HINT_SHARE = 0.5;

export interface BoxGroupView {
  tier: StorageTier;
  count: number;
  supplied: number;
  monthlyMinor: number | null;
}

export interface HubBoxesView {
  warehouseId: string;
  warehouseName: string;
  boxes: BoxGroupView[];
  monthlyMinor: number;
  nextChargeOn: string | null;
  unitsStored: number;
}

export interface VendorBoxesView {
  currency: string;
  hubs: HubBoxesView[];
  monthlyMinor: number;
}

export interface RepackCandidateView {
  vendorId: string;
  businessName: string;
  boxes: BoxGroupView[];
  monthlyMinor: number;
  unitsStored: number;
  unitsAtArrival: number;
  worthRepacking: boolean;
}

export interface HubRepackListView {
  currency: string;
  monthlyRates: Record<StorageTier, number | null>;
  vendors: RepackCandidateView[];
}

export const repackBoxesSchema = z
  .object({
    vendorId: z.string().uuid(),
    boxCounts: z.partialRecord(z.enum(STORAGE_TIERS), z.number().int().min(0).max(500)),
    photoFileIds: z.array(z.string().uuid()).min(1, "Add a photo of the repacked boxes").max(10),
    note: z.string().trim().max(500).optional(),
  })
  .refine((input) => Object.values(input.boxCounts).some((count) => count > 0), { path: ["boxCounts"], message: "Count at least one box" });
export type RepackBoxesInput = z.infer<typeof repackBoxesSchema>;

export function monthlyCost(counts: BoxCounts, monthly: Record<StorageTier, number | null>): number {
  return STORAGE_TIERS.reduce((total, tier) => total + (counts[tier] ?? 0) * (monthly[tier] ?? 0), 0);
}
