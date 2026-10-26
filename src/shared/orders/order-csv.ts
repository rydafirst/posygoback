import { z } from "zod";

import { externalReferenceSchema } from "./order.schema";

export const ORDER_CSV_COLUMNS = [
  "order_reference",
  "recipient_name",
  "company",
  "phone",
  "email",
  "address_line1",
  "address_line2",
  "city",
  "region",
  "postal_code",
  "country",
  "product_code",
  "quantity",
] as const;
export type OrderCsvColumn = (typeof ORDER_CSV_COLUMNS)[number];

export const ORDER_CSV_LIMITS = { maxBytes: 250_000, maxRows: 1000, maxOrders: 300, maxCellLength: 300, dailyOrdersPerVendor: 2000 } as const;

const RECIPIENT_COLUMNS: readonly OrderCsvColumn[] = ["recipient_name", "company", "phone", "email", "address_line1", "address_line2", "city", "region", "postal_code", "country"];

export class CsvFormatError extends Error {}

export function parseCsv(text: string): string[][] {
  const input = text.startsWith("﻿") ? text.slice(1) : text;
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  let index = 0;
  const endCell = () => {
    row.push(cell);
    cell = "";
  };
  const endRow = () => {
    endCell();
    if (row.some((value) => value.trim() !== "")) {
      rows.push(row);
    }
    row = [];
  };
  while (index < input.length) {
    const char = input[index]!;
    if (quoted) {
      if (char === '"' && input[index + 1] === '"') {
        cell += '"';
        index += 2;
        continue;
      }
      if (char === '"') {
        quoted = false;
      } else {
        cell += char;
      }
      index += 1;
      continue;
    }
    if (char === '"') {
      if (cell !== "") {
        throw new CsvFormatError(`Unexpected quote on line ${rows.length + 1}`);
      }
      quoted = true;
    } else if (char === ",") {
      endCell();
    } else if (char === "\n" || char === "\r") {
      endRow();
      if (char === "\r" && input[index + 1] === "\n") {
        index += 1;
      }
    } else {
      cell += char;
    }
    index += 1;
  }
  if (quoted) {
    throw new CsvFormatError("A quoted value is never closed");
  }
  if (cell !== "" || row.length > 0) {
    endRow();
  }
  return rows;
}

export interface CsvOrder {
  reference: string;
  rows: number[];
  recipient: Record<string, string>;
  lines: Array<{ row: number; productCode: string; quantity: number }>;
}

export interface CsvRowError {
  row: number;
  message: string;
}

const quantitySchema = z.coerce.number().int().min(1).max(1000);

export function groupOrderRows(table: string[][]): { orders: CsvOrder[]; errors: CsvRowError[] } {
  const [header, ...body] = table;
  const columns = (header ?? []).map((name) => name.trim().toLowerCase());
  const missing = ORDER_CSV_COLUMNS.filter((column) => !columns.includes(column));
  const unknown = columns.filter((column) => !(ORDER_CSV_COLUMNS as readonly string[]).includes(column));
  if (missing.length > 0 || unknown.length > 0) {
    const parts = [missing.length ? `missing ${missing.join(", ")}` : "", unknown.length ? `unknown ${unknown.join(", ")}` : ""].filter(Boolean);
    throw new CsvFormatError(`The header row doesn't match the template: ${parts.join("; ")}`);
  }
  const errors: CsvRowError[] = [];
  const byReference = new Map<string, CsvOrder>();
  body.forEach((cells, offset) => {
    const row = offset + 2;
    if (cells.length !== columns.length) {
      errors.push({ row, message: `Expected ${columns.length} columns, found ${cells.length}` });
      return;
    }
    const value = Object.fromEntries(columns.map((column, index) => [column, (cells[index] ?? "").trim()])) as Record<OrderCsvColumn, string>;
    if (Object.values(value).some((cell) => cell.length > ORDER_CSV_LIMITS.maxCellLength)) {
      errors.push({ row, message: `Keep each value under ${ORDER_CSV_LIMITS.maxCellLength} characters` });
      return;
    }
    const reference = externalReferenceSchema.safeParse(value.order_reference);
    const quantity = quantitySchema.safeParse(value.quantity);
    if (!reference.success) {
      errors.push({ row, message: "order_reference: use up to 64 letters, numbers or . _ : # / -" });
      return;
    }
    if (!value.product_code || !quantity.success) {
      errors.push({ row, message: "Each row needs a product_code and a quantity from 1 to 1000" });
      return;
    }
    const existing = byReference.get(reference.data);
    const recipient = Object.fromEntries(RECIPIENT_COLUMNS.map((column) => [column, value[column]]));
    if (!existing) {
      byReference.set(reference.data, { reference: reference.data, rows: [row], recipient, lines: [{ row, productCode: value.product_code.toUpperCase(), quantity: quantity.data }] });
      return;
    }
    const conflicting = RECIPIENT_COLUMNS.find((column) => value[column] !== "" && value[column] !== existing.recipient[column]);
    if (conflicting) {
      errors.push({ row, message: `${conflicting} differs from the first row of order ${reference.data}` });
      return;
    }
    existing.rows.push(row);
    existing.lines.push({ row, productCode: value.product_code.toUpperCase(), quantity: quantity.data });
  });
  return { orders: [...byReference.values()], errors };
}

export function csvRecipient(recipient: Record<string, string>) {
  const optional = (value: string | undefined) => (value ? value : undefined);
  return {
    name: recipient.recipient_name ?? "",
    company: optional(recipient.company),
    phone: optional(recipient.phone),
    email: optional(recipient.email),
    line1: recipient.address_line1 ?? "",
    line2: optional(recipient.address_line2),
    city: recipient.city ?? "",
    region: optional(recipient.region),
    postalCode: recipient.postal_code ?? "",
    countryCode: (recipient.country ?? "").toUpperCase(),
  };
}

export interface ImportResultView {
  id: string;
  filename: string;
  createdAt: string;
  ordersCreated: number;
  ordersFailed: number;
  results: Array<{ reference: string; rows: number[]; orderReference: string | null; message: string | null }>;
  rowErrors: CsvRowError[];
}
