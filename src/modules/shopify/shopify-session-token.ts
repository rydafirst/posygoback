import { createHmac, timingSafeEqual } from "node:crypto";

const SHOP_DOMAIN = /^[a-z0-9][a-z0-9-]*\.myshopify\.com$/;
const CLOCK_SKEW_SECONDS = 10;

interface SessionClaims {
  iss?: string;
  dest?: string;
  aud?: string;
  exp?: number;
  nbf?: number;
}

export function isShopDomain(value: unknown): value is string {
  return typeof value === "string" && SHOP_DOMAIN.test(value);
}

export function verifySessionToken(token: string, apiKey: string, secret: string, nowSeconds = Math.floor(Date.now() / 1000)): string | null {
  const [header, payload, signature] = token.split(".");
  if (!header || !payload || !signature) {
    return null;
  }
  const expected = createHmac("sha256", secret).update(`${header}.${payload}`).digest();
  const given = Buffer.from(signature, "base64url");
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) {
    return null;
  }
  const algorithm = decode<{ alg?: string }>(header)?.alg;
  const claims = decode<SessionClaims>(payload);
  if (algorithm !== "HS256" || !claims || claims.aud !== apiKey) {
    return null;
  }
  if (typeof claims.exp !== "number" || claims.exp + CLOCK_SKEW_SECONDS < nowSeconds) {
    return null;
  }
  if (typeof claims.nbf === "number" && claims.nbf - CLOCK_SKEW_SECONDS > nowSeconds) {
    return null;
  }
  const shop = hostOf(claims.dest);
  return isShopDomain(shop) && hostOf(claims.iss) === shop ? shop : null;
}

function decode<T>(part: string): T | null {
  try {
    return JSON.parse(Buffer.from(part, "base64url").toString("utf8")) as T;
  } catch {
    return null;
  }
}

function hostOf(value: string | undefined): string | null {
  try {
    return value ? new URL(value).host : null;
  } catch {
    return null;
  }
}
