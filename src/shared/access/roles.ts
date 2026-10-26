export const ROLES = ["VENDOR_OWNER", "VENDOR_MEMBER", "WAREHOUSE_OPERATOR", "FULFILMENT_PARTNER", "PARTNER_STAFF", "COUNTRY_OPS", "FINANCE_ADMIN", "COMPLIANCE", "ADMIN", "SUPER_ADMIN"] as const;

export type Role = (typeof ROLES)[number];

export type RoleScope = "VENDOR" | "WAREHOUSE" | "COUNTRY" | "PLATFORM";

const SCOPES: Record<Role, RoleScope> = {
  VENDOR_OWNER: "VENDOR",
  VENDOR_MEMBER: "VENDOR",
  WAREHOUSE_OPERATOR: "WAREHOUSE",
  FULFILMENT_PARTNER: "WAREHOUSE",
  PARTNER_STAFF: "WAREHOUSE",
  COUNTRY_OPS: "COUNTRY",
  FINANCE_ADMIN: "PLATFORM",
  COMPLIANCE: "PLATFORM",
  ADMIN: "PLATFORM",
  SUPER_ADMIN: "PLATFORM",
};

export const VENDOR_ROLES: readonly Role[] = ["VENDOR_OWNER", "VENDOR_MEMBER"];

export function roleScope(role: Role): RoleScope {
  return SCOPES[role];
}

export function isVendorRole(role: Role): boolean {
  return SCOPES[role] === "VENDOR";
}

export function requiresMfa(role: Role): boolean {
  return !isVendorRole(role);
}
