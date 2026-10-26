import { currencyDefinition } from "../../../shared";

export function decimalToMinor(amount: string, currency: string): number | null {
  const match = /^(\d{1,9})(?:\.(\d{1,6}))?$/.exec(amount.trim());
  if (!match) {
    return null;
  }
  const digits = currencyDefinition(currency).minorUnits;
  const fraction = (match[2] ?? "").padEnd(digits + 1, "0");
  const minor = Number(match[1]) * 10 ** digits + Number(fraction.slice(0, digits) || "0");
  return Number(fraction[digits]) >= 5 ? minor + 1 : minor;
}

export function minorToDecimal(amountMinor: number, currency: string): string {
  const digits = currencyDefinition(currency).minorUnits;
  return (amountMinor / 10 ** digits).toFixed(digits);
}
