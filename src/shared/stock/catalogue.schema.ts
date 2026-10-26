import { z } from "zod";

import { isoCountryCode } from "../country/country.schema";
import { isIsoCountryCode } from "../country/iso-countries";

export const STORAGE_TIERS = ["SMALL", "MEDIUM", "LARGE", "X_LARGE", "PALLET"] as const;
export type StorageTier = (typeof STORAGE_TIERS)[number];

export const BARCODE_SYMBOLOGIES = ["EAN13", "UPC_A", "GTIN14", "CODE128"] as const;
export type BarcodeSymbology = (typeof BARCODE_SYMBOLOGIES)[number];

export const PRODUCT_STATUSES = ["ACTIVE", "ARCHIVED"] as const;
export type ProductStatus = (typeof PRODUCT_STATUSES)[number];

const GTIN_LENGTH: Partial<Record<BarcodeSymbology, number>> = { EAN13: 13, UPC_A: 12, GTIN14: 14 };

export function hasValidGtinCheckDigit(value: string): boolean {
  if (!/^\d+$/.test(value)) {
    return false;
  }
  const digits = [...value].map(Number);
  const check = digits.pop()!;
  const sum = digits.reverse().reduce((total, digit, index) => total + digit * (index % 2 === 0 ? 3 : 1), 0);
  return (10 - (sum % 10)) % 10 === check;
}

export const barcodeSchema = z
  .object({
    value: z
      .string()
      .trim()
      .regex(/^[0-9A-Za-z-]{4,48}$/, "Use 4–48 letters, numbers or dashes"),
    symbology: z.enum(BARCODE_SYMBOLOGIES),
  })
  .superRefine((barcode, context) => {
    const length = GTIN_LENGTH[barcode.symbology];
    if (length && (barcode.value.length !== length || !hasValidGtinCheckDigit(barcode.value))) {
      context.addIssue({ code: "custom", path: ["value"], message: `Enter a valid ${length}-digit code` });
    }
  });
export type BarcodeInput = z.infer<typeof barcodeSchema>;

const millimetres = z.number().int().min(1).max(3000);

export const productInputSchema = z
  .object({
    code: z
      .string()
      .trim()
      .toUpperCase()
      .regex(/^[A-Z0-9][A-Z0-9-]{1,39}$/, "Use 2–40 letters, numbers or dashes"),
    name: z.string().trim().min(2).max(120),
    variantLabel: z.string().trim().max(60).optional(),
    hsCode: z
      .string()
      .trim()
      .regex(/^\d{6,10}$/, "Use the 6–10 digit tariff code")
      .optional(),
    countryOfOrigin: isoCountryCode.refine(isIsoCountryCode, "Choose a country"),
    declaredValueMinor: z.number().int().min(0).max(1_000_000_000),
    weightGrams: z.number().int().min(1).max(500_000),
    lengthMm: millimetres.optional(),
    widthMm: millimetres.optional(),
    heightMm: millimetres.optional(),
    storageTier: z.enum(STORAGE_TIERS),
    imageFileId: z.string().uuid().optional(),
    barcodes: z.array(barcodeSchema).max(10).default([]),
  })
  .superRefine((product, context) => {
    const dimensions = [product.lengthMm, product.widthMm, product.heightMm];
    if (dimensions.some((value) => value === undefined) && dimensions.some((value) => value !== undefined)) {
      context.addIssue({ code: "custom", path: ["lengthMm"], message: "Give all three dimensions or none" });
    }
    const values = product.barcodes.map((barcode) => barcode.value);
    if (new Set(values).size !== values.length) {
      context.addIssue({ code: "custom", path: ["barcodes"], message: "Each barcode can only be added once" });
    }
  });
export type ProductInput = z.infer<typeof productInputSchema>;

export interface ProductView {
  id: string;
  code: string;
  name: string;
  variantLabel: string | null;
  hsCode: string | null;
  countryOfOrigin: string;
  declaredValue: { amountMinor: number; currency: string };
  weightGrams: number;
  lengthMm: number | null;
  widthMm: number | null;
  heightMm: number | null;
  storageTier: StorageTier;
  imageFileId: string | null;
  barcodes: BarcodeInput[];
  status: ProductStatus;
  stock: { available: number; reserved: number; damaged: number };
  updatedAt: string;
}
