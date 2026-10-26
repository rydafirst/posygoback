import type { ClaimKind, ClaimLiability, ClaimSource, ClaimStatus, CustodyAlertKind, TransferStatus } from "./custody.schema";

export interface ClaimView {
  id: string;
  reference: string;
  countryCode: string;
  vendorName: string | null;
  warehouseName: string;
  partnerId: string | null;
  partnerName: string | null;
  kind: ClaimKind;
  source: ClaimSource;
  productName: string | null;
  lotCode: string | null;
  orderReference: string | null;
  quantity: number;
  unitValueMinor: number;
  amountMinor: number;
  currency: string;
  description: string;
  evidenceFileIds: string[];
  status: ClaimStatus;
  liability: ClaimLiability | null;
  writeOff: boolean;
  assessmentNote: string | null;
  assessedByEmail: string | null;
  partnerResponse: string | null;
  decisionNote: string | null;
  decidedByEmail: string | null;
  compensationMinor: number;
  recoveredLedgerMinor: number;
  recoveredDepositMinor: number;
  platformCoverMinor: number;
  createdAt: string;
  decidedAt: string | null;
}

export interface CustodyAlertView {
  id: string;
  kind: CustodyAlertKind;
  status: "OPEN" | "RESOLVED";
  countryCode: string;
  partnerId: string | null;
  partnerName: string | null;
  warehouseName: string | null;
  subjectType: string;
  subjectId: string;
  message: string;
  resolutionNote: string | null;
  createdAt: string;
  resolvedAt: string | null;
}

export interface TransferLineView {
  id: string;
  lotId: string;
  lotCode: string;
  productName: string;
  vendorName: string | null;
  quantitySent: number | null;
  quantityReceived: number | null;
}

export interface TransferView {
  id: string;
  reference: string;
  countryCode: string;
  fromWarehouse: { id: string; name: string; code: string };
  toWarehouse: { id: string; name: string; code: string };
  status: TransferStatus;
  reason: string;
  carrier: string | null;
  trackingNumber: string | null;
  sealNumber: string | null;
  dispatchedAt: string | null;
  receivedAt: string | null;
  createdAt: string;
  units: number | null;
  lines: TransferLineView[];
  actions: Array<"DISPATCH" | "RECEIVE" | "CANCEL">;
}

export interface HubSignalView {
  warehouseId: string;
  warehouseName: string;
  operator: "PLATFORM" | "PARTNER";
  tierName: string | null;
  insuredCoverMinor: number;
  currency: string;
  units: number;
  lastCountedAt: string | null;
}

export interface TrustView {
  score: number;
  floor: number;
  factors: Array<{ label: string; points: number }>;
}
