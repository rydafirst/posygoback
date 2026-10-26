import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

const KEY_PATTERN = /^gfn_(live|test)_([0-9a-f]{16})\.([0-9a-f]{64})$/;

export interface ParsedApiKey {
  keyId: string;
  secret: string;
}

export function newApiKey(live: boolean): { keyId: string; secret: string; key: string; prefix: string } {
  const keyId = randomBytes(8).toString("hex");
  const secret = randomBytes(32).toString("hex");
  const prefix = `gfn_${live ? "live" : "test"}_${keyId}`;
  return { keyId, secret, key: `${prefix}.${secret}`, prefix };
}

export function parseApiKey(value: string | undefined): ParsedApiKey | null {
  const match = value ? KEY_PATTERN.exec(value.trim()) : null;
  return match ? { keyId: match[2]!, secret: match[3]! } : null;
}

export function hashSecret(secret: string): string {
  return createHash("sha256").update(secret).digest("hex");
}

export function secretMatches(secret: string, storedHash: string): boolean {
  const given = Buffer.from(hashSecret(secret), "hex");
  const stored = Buffer.from(storedHash, "hex");
  return given.length === stored.length && timingSafeEqual(given, stored);
}

export function keyPrefix(keyId: string, live: boolean): string {
  return `gfn_${live ? "live" : "test"}_${keyId}`;
}
