export const IDENTITY_CHECK_STATUSES = ["PENDING", "IN_REVIEW", "APPROVED", "DECLINED", "ABANDONED", "EXPIRED"] as const;
export type IdentityCheckStatus = (typeof IDENTITY_CHECK_STATUSES)[number];

export const SETTLED_IDENTITY_STATUSES: readonly IdentityCheckStatus[] = ["APPROVED", "DECLINED", "ABANDONED", "EXPIRED"];
export const PASSING_IDENTITY_STATUSES: readonly IdentityCheckStatus[] = ["APPROVED", "IN_REVIEW"];

export interface IdentityCheckView {
  status: IdentityCheckStatus;
  provider: string;
  documentType: string | null;
  issuingCountry: string | null;
  documentExpiry: string | null;
  nameMatches: boolean | null;
  reason: string | null;
  decidedAt: string | null;
  updatedAt: string;
}

export interface IdentitySessionView {
  url: string;
}
