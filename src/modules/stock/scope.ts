import type { AuthPrincipal } from "../../common/auth/auth-principal";
import { Errors } from "../../common/http/app-exception";
import { Prisma } from "../../generated/prisma/client";
import { roleScope } from "../../shared";

export function warehouseCountryScope(principal: AuthPrincipal): string | null {
  const scope = roleScope(principal.role);
  if (scope === "PLATFORM") {
    return null;
  }
  if (scope === "VENDOR" || !principal.countryCode) {
    throw Errors.notFound();
  }
  return principal.countryCode;
}

export function warehouseScope(principal: AuthPrincipal): Prisma.WarehouseWhereInput {
  const country = warehouseCountryScope(principal);
  if (principal.role === "FULFILMENT_PARTNER" || principal.role === "PARTNER_STAFF") {
    if (!principal.partnerId) {
      throw Errors.notFound();
    }
    return { countryCode: country ?? "", partnerId: principal.partnerId };
  }
  return country ? { countryCode: country } : {};
}

export function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

export function uniqueViolationModel(error: unknown): string | null {
  if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
    return typeof error.meta?.modelName === "string" ? error.meta.modelName : "";
  }
  return null;
}

export function toDateOnly(value: string): Date {
  return new Date(`${value}T00:00:00.000Z`);
}

export function fromDateOnly(value: Date): string {
  return value.toISOString().slice(0, 10);
}
