import type { CountryStatus } from "./country.schema";

const ALLOWED_TRANSITIONS: Record<CountryStatus, readonly CountryStatus[]> = {
  PROSPECTIVE: ["ONBOARDING", "CLOSED"],
  ONBOARDING: ["LIVE", "PROSPECTIVE", "CLOSED"],
  LIVE: ["SUSPENDED"],
  SUSPENDED: ["LIVE", "CLOSED"],
  CLOSED: [],
};

export function canTransitionCountry(from: CountryStatus, to: CountryStatus): boolean {
  return ALLOWED_TRANSITIONS[from].includes(to);
}

export function acceptsNewVendors(status: CountryStatus): boolean {
  return status === "LIVE";
}
