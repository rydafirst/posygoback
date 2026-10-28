import type { AuthPrincipal } from "../../common/auth/auth-principal";
import { Errors } from "../../common/http/app-exception";

export function vendorIdOf(principal: AuthPrincipal): string {
  if (!principal.vendorId) {
    throw Errors.notFound();
  }
  return principal.vendorId;
}

export function reviewerCountryScope(principal: AuthPrincipal): string | null {
  if (principal.role !== "COUNTRY_OPS") {
    return null;
  }
  if (!principal.countryCode) {
    throw Errors.forbidden();
  }
  return principal.countryCode;
}
