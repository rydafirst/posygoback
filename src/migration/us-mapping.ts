export type SourceRole = "VENDOR" | "VENDOR_SUB_USER" | "WAREHOUSE_OPERATOR" | "FINANCE_ADMIN" | "ADMIN" | "SUPER_ADMIN";
export type SourceTier = "SMALL" | "MEDIUM" | "LARGE" | "X_LARGE" | "PALLET";
export type Symbology = "EAN13" | "UPC_A" | "GTIN14" | "CODE128";

const GRAMS_PER_OUNCE = 28.349523125;
const MM_PER_INCH = 25.4;
const VENDOR_ROLES: Partial<Record<SourceRole, "VENDOR_OWNER" | "VENDOR_MEMBER">> = { VENDOR: "VENDOR_OWNER", VENDOR_SUB_USER: "VENDOR_MEMBER" };
const KNOWN_SYMBOLOGIES: readonly string[] = ["EAN13", "UPC_A", "GTIN14", "CODE128"];

export function gramsFromOunces(ounces: number): number {
  return Math.max(1, Math.ceil(ounces * GRAMS_PER_OUNCE));
}

export function millimetresFromInches(inches: number | null): number | null {
  return inches === null || inches <= 0 ? null : Math.ceil(inches * MM_PER_INCH);
}

export function vendorRole(role: SourceRole): "VENDOR_OWNER" | "VENDOR_MEMBER" | null {
  return VENDOR_ROLES[role] ?? null;
}

export function vendorStatus(status: string): "ACTIVE" | "SUSPENDED" | "PENDING_VERIFICATION" | null {
  switch (status) {
    case "ACTIVE":
      return "ACTIVE";
    case "SUSPENDED":
      return "SUSPENDED";
    case "PENDING_KYC":
      return "PENDING_VERIFICATION";
    default:
      return null;
  }
}

export function symbology(value: string): Symbology {
  return (KNOWN_SYMBOLOGIES.includes(value) ? value : "CODE128") as Symbology;
}

export function productCode(code: string): string {
  return code
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9-]+/g, "-")
    .replace(/^-+/, "")
    .slice(0, 40);
}

export function variantLabel(variant: string): string | undefined {
  const label = variant.trim();
  return label === "" || label.toUpperCase() === "STD" ? undefined : label.slice(0, 60);
}

export function hsCode(value: string | null): string | null {
  const digits = (value ?? "").replace(/\D/g, "");
  return digits.length >= 6 && digits.length <= 10 ? digits : null;
}
