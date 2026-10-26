import { z } from "zod";

export const LEDGER_ENTRY_TYPES = [
  "DEPOSIT",
  "ONBOARDING",
  "STORAGE",
  "FULFILMENT",
  "SHIPPING",
  "RETURN",
  "RECEIVING_HOLD_FEE",
  "MANUAL_CREDIT",
  "MANUAL_DEBIT",
  "REFUND",
  "REVERSAL",
  "PAYMENT_REVERSAL",
  "COMPENSATION",
  "STOREFRONT_FEE",
  "REFERRAL_CREDIT",
  "CARRIED_OVER",
] as const;
export type LedgerEntryType = (typeof LEDGER_ENTRY_TYPES)[number];

export const CREDIT_TYPES: readonly LedgerEntryType[] = ["DEPOSIT", "MANUAL_CREDIT", "REFUND", "REVERSAL", "COMPENSATION", "REFERRAL_CREDIT", "CARRIED_OVER"];
export const DEBIT_TYPES: readonly LedgerEntryType[] = ["ONBOARDING", "STORAGE", "FULFILMENT", "SHIPPING", "RETURN", "RECEIVING_HOLD_FEE", "MANUAL_DEBIT", "PAYMENT_REVERSAL", "STOREFRONT_FEE"];

export const WALLET_STATUSES = ["ACTIVE", "STORAGE_OVERDUE", "FROZEN", "CLOSED"] as const;
export type WalletStatus = (typeof WALLET_STATUSES)[number];

export const TOP_UP_STATUSES = ["PENDING", "SUCCEEDED", "FAILED", "EXPIRED", "REFUNDED"] as const;
export type TopUpStatus = (typeof TOP_UP_STATUSES)[number];

export const TOP_UP_LIMITS = { minMajor: 1, maxMajor: 100_000 } as const;

export const startTopUpSchema = z.object({ amountMinor: z.number().int().positive().max(100_000_000) });
export type StartTopUpInput = z.infer<typeof startTopUpSchema>;

export const walletSettingsSchema = z.object({ lowBalanceThresholdMinor: z.number().int().min(0).max(100_000_000) });
export type WalletSettingsInput = z.infer<typeof walletSettingsSchema>;

export const ADJUSTMENT_DIRECTIONS = ["CREDIT", "DEBIT"] as const;
export type AdjustmentDirection = (typeof ADJUSTMENT_DIRECTIONS)[number];

export const ADJUSTMENT_STATUSES = ["PENDING_APPROVAL", "APPLIED", "REJECTED"] as const;
export type AdjustmentStatus = (typeof ADJUSTMENT_STATUSES)[number];

export const requestAdjustmentSchema = z.object({
  direction: z.enum(ADJUSTMENT_DIRECTIONS),
  amountMinor: z.number().int().positive().max(100_000_000),
  reason: z.string().trim().min(10).max(300),
  reference: z.string().trim().max(120).optional(),
});
export type RequestAdjustmentInput = z.infer<typeof requestAdjustmentSchema>;

export const adjustmentDecisionSchema = z.object({ approve: z.boolean(), note: z.string().trim().min(5).max(300) });
export type AdjustmentDecisionInput = z.infer<typeof adjustmentDecisionSchema>;

export function grossUpForProcessorFees(netMinor: number, percentBps: number, fixedMinor: number): number {
  return Math.ceil((netMinor + fixedMinor) / (1 - percentBps / 10_000));
}

export interface WalletView {
  id: string;
  vendorId: string;
  businessName: string;
  countryCode: string;
  currency: string;
  balanceMinor: number;
  lowBalanceThresholdMinor: number;
  status: WalletStatus;
}

export interface LedgerEntryView {
  id: string;
  type: LedgerEntryType;
  amountMinor: number;
  balanceAfterMinor: number;
  description: string;
  createdAt: string;
}

export interface TopUpView {
  id: string;
  status: TopUpStatus;
  netMinor: number;
  grossMinor: number;
  feeMinor: number;
  currency: string;
  createdAt: string;
}

export interface TopUpStarted {
  topUpId: string;
  redirectUrl: string;
  netMinor: number;
  grossMinor: number;
  feeMinor: number;
}

export interface TopUpQuote {
  netMinor: number;
  grossMinor: number;
  feeMinor: number;
  currency: string;
}

export interface AdjustmentView {
  id: string;
  walletId: string;
  businessName: string;
  currency: string;
  direction: AdjustmentDirection;
  amountMinor: number;
  reason: string;
  reference: string | null;
  status: AdjustmentStatus;
  requestedByEmail: string;
  decidedByEmail: string | null;
  decisionNote: string | null;
  createdAt: string;
}

export interface ReconciliationReportView {
  id: string;
  ranAt: string;
  walletsChecked: number;
  mismatches: Array<{ walletId: string; balanceMinor: number; ledgerSumMinor: number }>;
}
