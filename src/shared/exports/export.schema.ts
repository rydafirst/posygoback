import { z } from "zod";

export const EXPORT_KINDS = ["orders", "ledger", "inventory"] as const;
export type ExportKind = (typeof EXPORT_KINDS)[number];

export const EXPORT_LIMITS = { maxRows: 20_000, maxDays: 366 } as const;

const isoDay = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use a date like 2026-01-31");

export const exportRangeSchema = z
  .object({ from: isoDay, to: isoDay })
  .refine((range) => range.from <= range.to, { message: "The start must be on or before the end", path: ["to"] })
  .refine((range) => (Date.parse(range.to) - Date.parse(range.from)) / 86_400_000 < EXPORT_LIMITS.maxDays, { message: `Choose up to ${EXPORT_LIMITS.maxDays} days`, path: ["to"] });
export type ExportRange = z.infer<typeof exportRangeSchema>;
