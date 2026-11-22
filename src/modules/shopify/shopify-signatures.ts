import { createHmac, timingSafeEqual } from "node:crypto";

export function shopifySignatureMatches(rawBody: Buffer, secret: string, presented: string | string[] | undefined): boolean {
  if (typeof presented !== "string" || !secret) {
    return false;
  }
  const expected = createHmac("sha256", secret).update(rawBody).digest();
  const given = Buffer.from(presented, "base64");
  return given.length === expected.length && timingSafeEqual(given, expected);
}
