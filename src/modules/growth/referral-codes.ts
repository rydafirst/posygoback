import { randomCode } from "../stock/inbound/references";

const CODE = /^[A-Z0-9][A-Z0-9-]{2,39}$/;

export function normaliseCode(raw: string | undefined): string | null {
  const code = raw?.trim().toUpperCase() ?? "";
  return CODE.test(code) ? code : null;
}

export function codeFor(businessName: string): string {
  const stem =
    businessName
      .toUpperCase()
      .replace(/[^A-Z0-9]/g, "")
      .slice(0, 8) || "VENDOR";
  return `${stem}-${randomCode(4)}`;
}
