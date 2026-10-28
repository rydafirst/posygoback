import { z } from "zod";

import type { Role } from "../access/roles";
import type { VerificationStatus } from "../onboarding/verification.schema";

export const VENDOR_STAGES = ["SIGNED_UP", "VERIFYING", "VERIFIED", "LIVE", "SUSPENDED"] as const;
export type VendorStage = (typeof VENDOR_STAGES)[number];

export const PRODUCT_STOCK_STATES = ["NOT_SENT", "ON_THE_WAY", "IN_STORAGE", "SOLD_OUT"] as const;
export type ProductStockState = (typeof PRODUCT_STOCK_STATES)[number];

export const VERIFYING_STATUSES: readonly VerificationStatus[] = ["IN_PROGRESS", "SUBMITTED", "RESUBMISSION_REQUIRED", "REJECTED"];

export interface StageFacts {
  vendorStatus: "PENDING_VERIFICATION" | "ACTIVE" | "SUSPENDED" | "CLOSED";
  verificationStatus: VerificationStatus | null;
  ownerEmailVerified: boolean;
}

export function vendorStage(facts: StageFacts): VendorStage {
  if (facts.vendorStatus === "SUSPENDED" || facts.vendorStatus === "CLOSED") {
    return "SUSPENDED";
  }
  if (facts.vendorStatus === "ACTIVE") {
    return "LIVE";
  }
  if (facts.verificationStatus === "APPROVED") {
    return "VERIFIED";
  }
  if (facts.ownerEmailVerified && facts.verificationStatus !== null && VERIFYING_STATUSES.includes(facts.verificationStatus)) {
    return "VERIFYING";
  }
  return "SIGNED_UP";
}

export interface StockFacts {
  unitsInStorage: number;
  unitsOnTheWay: number;
  everStored: boolean;
}

export function productStockState(facts: StockFacts): ProductStockState {
  if (facts.unitsInStorage > 0) {
    return "IN_STORAGE";
  }
  if (facts.unitsOnTheWay > 0) {
    return "ON_THE_WAY";
  }
  return facts.everStored ? "SOLD_OUT" : "NOT_SENT";
}

export const DIRECTORY_PAGE_SIZE = 50;

const search = z.string().trim().max(100).optional();
const pageNumber = z.coerce.number().int().min(1).max(10_000).default(1);

export const vendorDirectoryQuerySchema = z.object({
  q: search,
  country: z
    .string()
    .regex(/^[A-Z]{2}$/)
    .optional(),
  stage: z.enum(VENDOR_STAGES).optional(),
  page: pageNumber,
});
export type VendorDirectoryQuery = z.infer<typeof vendorDirectoryQuerySchema>;

export const productDirectoryQuerySchema = z.object({ q: search, vendorId: z.string().uuid().optional(), stock: z.enum(PRODUCT_STOCK_STATES).optional(), page: pageNumber });
export type ProductDirectoryQuery = z.infer<typeof productDirectoryQuerySchema>;

export interface DirectoryPage<Row> {
  items: Row[];
  total: number;
  page: number;
  pageSize: number;
}

export interface VendorRowView {
  id: string;
  businessName: string;
  ownerEmail: string | null;
  countryCode: string;
  joinedAt: string;
  stage: VendorStage;
  verificationStatus: VerificationStatus;
  productCount: number;
  unitsInStorage: number;
  walletBalanceMinor: number;
  currency: string;
}

export interface VendorMemberView {
  userId: string;
  email: string;
  role: Role;
  status: string;
  emailVerified: boolean;
  joinedAt: string;
}

export interface ProductRowView {
  id: string;
  name: string;
  code: string;
  variantLabel: string | null;
  vendorId: string;
  businessName: string;
  addedByEmail: string | null;
  addedAt: string;
  unitsInStorage: number;
  unitsOnTheWay: number;
  stockState: ProductStockState;
}

export interface VendorDetailView {
  id: string;
  businessName: string;
  countryCode: string;
  joinedAt: string;
  stage: VendorStage;
  isTestAccount: boolean;
  members: VendorMemberView[];
  verification: { status: VerificationStatus; submittedAt: string | null; decidedAt: string | null };
  countries: string[];
  wallet: { balanceMinor: number; currency: string };
  counts: { products: number; inboundShipments: number; orders: number };
  unitsInStorage: number;
  products: ProductRowView[];
}
