import { createHmac, timingSafeEqual } from "node:crypto";

import type { StorePlatform } from "../../../shared";

const SIGNATURE_HEADERS: Record<StorePlatform, string> = { SHOPIFY: "x-shopify-hmac-sha256", WOOCOMMERCE: "x-wc-webhook-signature" };

export function signatureHeader(platform: StorePlatform): string {
  return SIGNATURE_HEADERS[platform];
}

export function signatureMatches(rawBody: Buffer, secret: string, presented: string | undefined): boolean {
  if (!presented) {
    return false;
  }
  const expected = createHmac("sha256", secret).update(rawBody).digest();
  const given = Buffer.from(presented, "base64");
  return given.length === expected.length && timingSafeEqual(given, expected);
}
