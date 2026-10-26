export const PARTNER_STATUSES = ["APPLIED", "VERIFYING", "UNDER_REVIEW", "ACTIVE", "SUSPENDED", "OFFBOARDING", "TERMINATED", "REJECTED"] as const;
export type PartnerStatus = (typeof PARTNER_STATUSES)[number];

export const PARTNER_TRANSITIONS: Record<PartnerStatus, readonly PartnerStatus[]> = {
  APPLIED: ["VERIFYING", "REJECTED"],
  VERIFYING: ["UNDER_REVIEW", "REJECTED"],
  UNDER_REVIEW: ["VERIFYING", "ACTIVE", "REJECTED"],
  ACTIVE: ["SUSPENDED", "OFFBOARDING"],
  SUSPENDED: ["ACTIVE", "OFFBOARDING"],
  OFFBOARDING: ["TERMINATED"],
  TERMINATED: [],
  REJECTED: [],
};

export function canMovePartner(from: PartnerStatus, to: PartnerStatus): boolean {
  return PARTNER_TRANSITIONS[from].includes(to);
}

export const PARTNER_DECISIONS = ["APPROVE", "RETURN", "REJECT", "SUSPEND", "REINSTATE", "OFFBOARD", "TERMINATE"] as const;
export type PartnerDecision = (typeof PARTNER_DECISIONS)[number];

export const DECISION_TARGET: Record<PartnerDecision, PartnerStatus> = {
  APPROVE: "ACTIVE",
  RETURN: "VERIFYING",
  REJECT: "REJECTED",
  SUSPEND: "SUSPENDED",
  REINSTATE: "ACTIVE",
  OFFBOARD: "OFFBOARDING",
  TERMINATE: "TERMINATED",
};

const DECISION_SOURCE: Partial<Record<PartnerDecision, PartnerStatus>> = { APPROVE: "UNDER_REVIEW", REINSTATE: "SUSPENDED" };

export const MANAGER_DECISIONS: readonly PartnerDecision[] = ["REINSTATE", "OFFBOARD", "TERMINATE"];

export function decisionsFrom(status: PartnerStatus): PartnerDecision[] {
  return PARTNER_DECISIONS.filter((decision) => {
    const source = DECISION_SOURCE[decision];
    return source ? source === status : canMovePartner(status, DECISION_TARGET[decision]);
  });
}

export const OPERATING_PARTNER_STATUSES: readonly PartnerStatus[] = ["ACTIVE"];
export const CLOSED_PARTNER_STATUSES: readonly PartnerStatus[] = ["TERMINATED", "REJECTED"];
