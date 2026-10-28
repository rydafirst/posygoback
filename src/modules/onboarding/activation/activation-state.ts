import type { ActivationState } from "../../../shared";

interface VendorStanding {
  status: string;
  activationDueAt: Date | null;
}

export function isAwaitingActivation(vendor: VendorStanding): boolean {
  return vendor.status === "PENDING_VERIFICATION" && vendor.activationDueAt !== null;
}

export function activationStateOf(vendor: VendorStanding): ActivationState {
  if (vendor.status === "ACTIVE") {
    return "LIVE";
  }
  return isAwaitingActivation(vendor) ? "DUE" : "NOT_READY";
}
