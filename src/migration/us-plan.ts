import { barcodeSchema, type ProductInput, productInputSchema } from "../shared";
import { gramsFromOunces, hsCode, millimetresFromInches, productCode, symbology, variantLabel, vendorRole, vendorStatus } from "./us-mapping";
import type { SourceBlockers, SourceProduct, SourceSnapshot } from "./us-source";

export interface PlannedUser {
  sourceId: string;
  email: string;
  passwordHash: string;
  role: "VENDOR_OWNER" | "VENDOR_MEMBER";
  active: boolean;
}

export interface PlannedProduct {
  sourceId: string;
  input: ProductInput;
  sellable: number;
  damaged: number;
  locationCodes: string[];
}

export interface PlannedVendor {
  sourceId: string;
  businessName: string;
  status: "ACTIVE" | "SUSPENDED" | "PENDING_VERIFICATION";
  users: PlannedUser[];
  products: PlannedProduct[];
  walletCents: number;
}

export interface Problem {
  severity: "BLOCKER" | "SKIPPED" | "NOTE";
  subject: string;
  detail: string;
}

export interface ImportPlan {
  vendors: PlannedVendor[];
  problems: Problem[];
  blockers: SourceBlockers;
  takenAt: Date;
}

const DAMAGED = ["DAMAGED", "QUARANTINED"];

function productInput(product: SourceProduct, problems: Problem[]): ProductInput | null {
  const barcodes = product.barcodes.flatMap((barcode) => {
    const parsed = barcodeSchema.safeParse({ value: barcode.value.trim(), symbology: symbology(barcode.symbology) });
    if (!parsed.success) {
      problems.push({ severity: "NOTE", subject: `Product ${product.code}`, detail: `Barcode ${barcode.value} left off: ${parsed.error.issues[0]!.message}` });
      return [];
    }
    return [parsed.data];
  });
  const parsed = productInputSchema.safeParse({
    code: productCode(product.code),
    name: product.name.trim().slice(0, 120),
    variantLabel: variantLabel(product.variant),
    hsCode: hsCode(product.hsCode) ?? undefined,
    countryOfOrigin: product.countryOfOrigin,
    declaredValueMinor: product.declaredValueCents,
    weightGrams: gramsFromOunces(product.weightOz),
    lengthMm: millimetresFromInches(product.lengthIn) ?? undefined,
    widthMm: millimetresFromInches(product.widthIn) ?? undefined,
    heightMm: millimetresFromInches(product.heightIn) ?? undefined,
    storageTier: product.storageTier,
    barcodes: barcodes.slice(0, 10),
  });
  if (!parsed.success) {
    const issue = parsed.error.issues[0]!;
    problems.push({ severity: "BLOCKER", subject: `Product ${product.code}`, detail: `Can't be moved: ${issue.path.join(".") || "product"} — ${issue.message}` });
    return null;
  }
  return parsed.data;
}

function users(snapshot: SourceSnapshot, vendorId: string, problems: Problem[]): PlannedUser[] {
  return snapshot.users
    .filter((user) => user.vendorId === vendorId)
    .flatMap((user) => {
      const role = vendorRole(user.role);
      if (!role || user.status === "CLOSED") {
        problems.push({ severity: "SKIPPED", subject: user.email, detail: role ? "Closed account" : `Role ${user.role} isn't a vendor role; invite them as staff instead` });
        return [];
      }
      if (!user.passwordHash.startsWith("$argon2")) {
        problems.push({ severity: "BLOCKER", subject: user.email, detail: "Password isn't stored in a format we can check" });
        return [];
      }
      return [{ sourceId: user.id, email: user.email, passwordHash: user.passwordHash, role, active: user.status === "ACTIVE" && user.emailVerified }];
    });
}

export function planUsImport(snapshot: SourceSnapshot): ImportPlan {
  const problems: Problem[] = [];
  const vendors = snapshot.vendors.flatMap((vendor): PlannedVendor[] => {
    const status = vendorStatus(vendor.status);
    if (!status) {
      problems.push({ severity: "SKIPPED", subject: vendor.businessName, detail: `Status ${vendor.status}` });
      return [];
    }
    const products = snapshot.products
      .filter((product) => product.vendorId === vendor.id)
      .flatMap((product): PlannedProduct[] => {
        const input = productInput(product, problems);
        const stock = snapshot.stock.filter((entry) => entry.productId === product.id);
        if (stock.some((entry) => entry.quantityReserved > 0)) {
          problems.push({ severity: "BLOCKER", subject: `Product ${product.code}`, detail: "Has stock held for an order. Finish or cancel those orders first" });
        }
        if (!input) {
          return [];
        }
        return [
          {
            sourceId: product.id,
            input,
            sellable: stock.filter((entry) => !DAMAGED.includes(entry.status)).reduce((total, entry) => total + entry.quantityAvailable, 0),
            damaged: stock.filter((entry) => DAMAGED.includes(entry.status)).reduce((total, entry) => total + entry.quantityAvailable, 0),
            locationCodes: [...new Set(stock.flatMap((entry) => (entry.locationCode ? [entry.locationCode] : [])))],
          },
        ];
      });
    const codes = new Map<string, number>();
    for (const product of products) {
      codes.set(product.input.code, (codes.get(product.input.code) ?? 0) + 1);
    }
    for (const [code, uses] of codes) {
      if (uses > 1) {
        problems.push({ severity: "BLOCKER", subject: vendor.businessName, detail: `${uses} products would share the code ${code}` });
      }
    }
    const walletCents = snapshot.wallets.get(vendor.id) ?? 0;
    if (walletCents < 0) {
      problems.push({ severity: "BLOCKER", subject: vendor.businessName, detail: `Wallet is overdrawn by ${(-walletCents / 100).toFixed(2)} USD. Settle it first` });
    }
    const planned = users(snapshot, vendor.id, problems);
    if (!planned.some((user) => user.role === "VENDOR_OWNER")) {
      problems.push({ severity: "BLOCKER", subject: vendor.businessName, detail: "No owner account to move" });
    }
    return [{ sourceId: vendor.id, businessName: vendor.businessName.trim().slice(0, 120), status, users: planned, products, walletCents: Math.max(0, walletCents) }];
  });
  const blockers = snapshot.blockers;
  const open: Array<[number, string]> = [
    [blockers.ordersInProgress, "orders still being packed or waiting to ship"],
    [blockers.inboundsOpen, "stock shipments not yet fully received"],
    [blockers.shoppingOpen, "personal shopping requests still open"],
    [blockers.storePayoutsOwed, "store sales still owed to vendors"],
  ];
  for (const [amount, what] of open) {
    if (amount > 0) {
      problems.push({ severity: "BLOCKER", subject: "Old system", detail: `${amount} ${what}` });
    }
  }
  return { vendors, problems, blockers, takenAt: snapshot.takenAt };
}
