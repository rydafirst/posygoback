import type { SignatureCertificateView } from "../onboarding/signature.schema";
import type { PartnerDecision, PartnerStatus } from "./partner-lifecycle";
import type { HeardFrom, PartnerCheckKind, PartnerCheckStatus, PartnerEntryType, PartnerKind, PartnerLegalKind, PartnerProfileInput, SecurityKind } from "./partner.schema";

export interface PartnerCheckView {
  kind: PartnerCheckKind;
  status: PartnerCheckStatus;
  details: Record<string, string | boolean | null>;
  statement: string | null;
  fileIds: string[];
  filesPurged: boolean;
  reviewNote: string | null;
  submittedAt: string | null;
  reviewedAt: string | null;
  callScheduledAt: string | null;
  callOutcome: string | null;
}

export interface PartnerAgreementView {
  kind: PartnerLegalKind;
  documentId: string | null;
  title: string | null;
  version: string | null;
  signedAt: string | null;
  signatureName: string | null;
  certificate: SignatureCertificateView | null;
}

export interface InsurancePolicyView {
  id: string;
  insurer: string;
  policyNumber: string;
  coverMinor: number;
  currency: string;
  startsOn: string;
  expiresOn: string;
  fileId: string;
  status: "PENDING" | "VERIFIED" | "REJECTED" | "EXPIRED";
  reviewNote: string | null;
}

export interface SecurityView {
  id: string;
  kind: SecurityKind;
  amountMinor: number;
  drawnMinor: number;
  currency: string;
  reference: string;
  receivedAt: string;
  expiresOn: string | null;
  confirmedAt: string | null;
  releasedAt: string | null;
}

export interface PayoutAccountView {
  provider: string;
  status: "ONBOARDING" | "ACTIVE" | "RESTRICTED";
  bankSummary: string | null;
  detailsChangedAt: string | null;
}

export interface ActivationReadiness {
  steps: boolean;
  agreement: boolean;
  payoutAccount: boolean;
  deposit: boolean;
  insurance: boolean;
}

export interface TierView {
  level: number;
  name: string;
  maxStockValueMinor: number;
  maxItemValueMinor: number;
}

export interface PartnerSummaryView {
  id: string;
  reference: string;
  legalName: string;
  kind: PartnerKind;
  countryCode: string;
  city: string | null;
  status: PartnerStatus;
  tierLevel: number;
  founding: boolean;
  warehouses: Array<{ id: string; code: string; name: string }>;
  createdAt: string;
}

export interface PartnerDetailView extends PartnerSummaryView {
  contactEmail: string;
  profile: PartnerProfileInput | null;
  heardFrom: HeardFrom | null;
  statusReason: string | null;
  currency: string;
  requiredDepositMinor: number;
  requiredInsuranceMinor: number;
  tier: TierView;
  heldStockValueMinor: number;
  workStatus: { taxIdLabel: string; taxIdRequired: boolean; declaration: string };
  checks: PartnerCheckView[];
  agreements: PartnerAgreementView[];
  insurance: InsurancePolicyView[];
  securities: SecurityView[];
  payoutAccount: PayoutAccountView | null;
  readiness: ActivationReadiness;
  decisions: PartnerDecision[];
  team: Array<{ userId: string; email: string; role: "FULFILMENT_PARTNER" | "PARTNER_STAFF"; status: string }>;
  pendingInvitations: Array<{ id: string; email: string; role: "FULFILMENT_PARTNER" | "PARTNER_STAFF"; expiresAt: string }>;
}

export interface ScorecardView {
  periodDays: number;
  daysActive: number;
  ordersShipped: number;
  cleanOrders: number;
  evidenceCompliancePct: number | null;
  medianDispatchHours: number | null;
  countLines: number;
  countAccuracyPct: number | null;
  countsMatched: number;
  countsFlagged: number;
  countsMissed: number;
  mysteryPassed: number | null;
  mysteryFailed: number | null;
  shortUnits: number;
  lossRatePct: number | null;
  nextTier: { level: number; name: string; ordersNeeded: number; countsNeeded: number; daysNeeded: number; blocked: string | null } | null;
}

export interface PartnerLedgerEntryView {
  id: string;
  type: PartnerEntryType;
  bucket: "AVAILABLE" | "HELD";
  amountMinor: number;
  description: string;
  releaseOn: string | null;
  createdAt: string;
}

export interface PartnerStatementView {
  currency: string;
  availableMinor: number;
  heldMinor: number;
  from: string;
  to: string;
  earnedMinor: number;
  paidMinor: number;
  entries: PartnerLedgerEntryView[];
  awaitingEvidence: Array<{ orderId: string; reference: string; handedOffAt: string | null }>;
}

export interface PartnerPayoutView {
  id: string;
  partnerId: string;
  legalName: string;
  amountMinor: number;
  currency: string;
  status: "PENDING_APPROVAL" | "PROCESSING" | "PAID" | "FAILED" | "REJECTED";
  note: string;
  failureReason: string | null;
  requestedByEmail: string;
  decidedByEmail: string | null;
  createdAt: string;
}

export interface StockCountLineView {
  id: string;
  lotCode: string;
  productCode: string;
  productName: string;
  location: string | null;
  expectedQuantity: number | null;
  countedQuantity: number | null;
}

export interface StockCountView {
  id: string;
  partnerId: string;
  legalName: string;
  warehouseName: string;
  status: "REQUESTED" | "MATCHED" | "FLAGGED" | "MISSED";
  note: string | null;
  dueAt: string;
  videoFileId: string | null;
  submittedAt: string | null;
  mismatchedLines: number;
  resolvedAt: string | null;
  resolutionNote: string | null;
  claimsOpened: number;
  createdAt: string;
  lines: StockCountLineView[];
}

export interface MysteryOrderView {
  orderId: string;
  reference: string;
  partnerId: string;
  legalName: string;
  orderStatus: string;
  outcome: "PENDING" | "PASSED" | "FAILED";
  outcomeNote: string | null;
  createdAt: string;
  handedOffAt: string | null;
}

export interface MysteryProductView {
  productId: string;
  code: string;
  name: string;
  available: number;
}

export interface HubView {
  countryCode: string;
  countryName: string;
  currency: string;
  insuredCoverMinor: number;
}

export interface PartnerProgrammeView {
  countryCode: string;
  countryName: string;
  currency: string;
  receivingShareBps: number;
  storageShareBps: number;
  fulfilmentShareBps: number;
  foundingBonusBps: number;
  foundingPlacesLeft: number;
  holdbackBps: number;
  holdbackDays: number;
  example: { boxesReceived: number; boxesStored: number; ordersPacked: number; monthlyMinor: number };
}

export interface PartnerStockSummaryView {
  unitsStored: number;
  unitsReserved: number;
  sellers: number;
  products: number;
  lotsWaitingToShelve: number;
  shipmentsExpected: number;
  ordersToPack: number;
  ordersToShip: number;
}
