import { randomInt } from "node:crypto";

const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

export function randomCode(length: number): string {
  return Array.from({ length }, () => ALPHABET[randomInt(ALPHABET.length)]).join("");
}

export function inboundReference(countryCode: string): string {
  return `IN-${countryCode}-${randomCode(6)}`;
}

export function lotCode(countryCode: string, vendorId: string, productCode: string, sequence: number): string {
  return `${countryCode}-${vendorId.replace(/-/g, "").slice(0, 6).toUpperCase()}-${productCode}-${String(sequence).padStart(4, "0")}`;
}
