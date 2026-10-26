import { z } from "zod";

export const CLAIM_KINDS = ["SHORTAGE", "DAMAGE", "LOSS"] as const;
export type ClaimKind = (typeof CLAIM_KINDS)[number];

export const CLAIM_SOURCES = ["STOCK_COUNT", "TRANSFER", "ORDER", "VENDOR_REPORT", "STAFF"] as const;
export type ClaimSource = (typeof CLAIM_SOURCES)[number];

export const CLAIM_STATUSES = ["OPEN", "ASSESSED", "SETTLED", "REJECTED"] as const;
export type ClaimStatus = (typeof CLAIM_STATUSES)[number];

export const CLAIM_LIABILITIES = ["PARTNER", "PLATFORM", "CARRIER", "VENDOR"] as const;
export type ClaimLiability = (typeof CLAIM_LIABILITIES)[number];

const text = (min: number, max: number) => z.string().trim().min(min).max(max);
const fileIds = z.array(z.string().uuid()).max(6).default([]);

export const reportClaimSchema = z
  .object({
    orderId: z.string().uuid().optional(),
    lotId: z.string().uuid().optional(),
    kind: z.enum(CLAIM_KINDS),
    quantity: z.number().int().min(1).max(10_000),
    description: text(20, 1000),
    fileIds,
  })
  .refine((input) => Boolean(input.orderId) !== Boolean(input.lotId), { message: "Choose the order or the stock the problem is about", path: ["orderId"] });
export type ReportClaimInput = z.infer<typeof reportClaimSchema>;

export const assessClaimSchema = z.object({ liability: z.enum(CLAIM_LIABILITIES), amountMinor: z.number().int().min(0).max(100_000_000), writeOff: z.boolean(), note: text(10, 1000) });
export type AssessClaimInput = z.infer<typeof assessClaimSchema>;

export const decideClaimSchema = z.object({ approve: z.boolean(), note: text(5, 500) });
export type DecideClaimInput = z.infer<typeof decideClaimSchema>;

export const claimResponseSchema = z.object({ response: text(10, 1000) });

export const resolveAlertSchema = z.object({ note: text(10, 1000) });

export const TRANSFER_STATUSES = ["REQUESTED", "DISPATCHED", "RECEIVED", "CANCELLED"] as const;
export type TransferStatus = (typeof TRANSFER_STATUSES)[number];

export const createTransferSchema = z.object({ fromWarehouseId: z.string().uuid(), toWarehouseId: z.string().uuid(), reason: text(10, 500), lotIds: z.array(z.string().uuid()).max(500).optional() });
export type CreateTransferInput = z.infer<typeof createTransferSchema>;

export const dispatchTransferSchema = z.object({
  carrier: text(2, 80),
  trackingNumber: text(3, 80),
  sealNumber: text(3, 40),
  photoFileIds: z.array(z.string().uuid()).min(1, "Add a photo of the sealed boxes").max(6),
});
export type DispatchTransferInput = z.infer<typeof dispatchTransferSchema>;

export const receiveTransferSchema = z.object({
  lines: z
    .array(z.object({ lineId: z.string().uuid(), quantityReceived: z.number().int().min(0).max(1_000_000) }))
    .min(1)
    .max(500),
});
export type ReceiveTransferInput = z.infer<typeof receiveTransferSchema>;

export const CUSTODY_ALERT_KINDS = ["NO_CARRIER_SCAN", "COUNT_SHORTFALL", "SHRINKAGE", "TRUST_LOW"] as const;
export type CustodyAlertKind = (typeof CUSTODY_ALERT_KINDS)[number];
