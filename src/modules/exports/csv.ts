const RISKY_START = /^[=+\-@\t\r]/;

export type CsvCell = string | number | null | undefined;

function cell(value: CsvCell): string {
  if (value === null || value === undefined) {
    return "";
  }
  const text = String(value);
  const safe = typeof value === "string" && RISKY_START.test(text) ? `'${text}` : text;
  return /[",\r\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

export function toCsv(header: readonly string[], rows: readonly CsvCell[][]): string {
  return `﻿${[header, ...rows].map((row) => row.map(cell).join(",")).join("\r\n")}\r\n`;
}

export function minorToDecimal(amountMinor: number | bigint | null, digits: number): string | null {
  if (amountMinor === null) {
    return null;
  }
  const value = Number(amountMinor);
  return (value / 10 ** digits).toFixed(digits);
}
