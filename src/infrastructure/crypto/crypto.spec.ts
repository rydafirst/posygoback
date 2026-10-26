import { randomBytes } from "node:crypto";

import type { AppConfig } from "../../config/config.schema";
import { DecryptionError, FieldEncryptionService } from "./field-encryption.service";
import { SecretHasherService } from "./secret-hasher.service";

const keyV1 = randomBytes(32);
const keyV2 = randomBytes(32);

function config(active: string, keys: Record<string, Buffer>): AppConfig {
  return { FIELD_ENCRYPTION_KEYS: keys, FIELD_ENCRYPTION_ACTIVE_KEY: active, BLIND_INDEX_KEY: randomBytes(32).toString("base64") } as AppConfig;
}

describe("FieldEncryptionService", () => {
  it("round-trips a value bound to its context", () => {
    const service = new FieldEncryptionService(config("v1", { v1: keyV1 }));
    const encrypted = service.encrypt("AB123456C", "user:1:id_number");
    expect(encrypted).not.toContain("AB123456C");
    expect(service.decrypt(encrypted, "user:1:id_number")).toBe("AB123456C");
  });

  it("refuses to decrypt under a different context", () => {
    const service = new FieldEncryptionService(config("v1", { v1: keyV1 }));
    const encrypted = service.encrypt("secret", "user:1:mfa");
    expect(() => service.decrypt(encrypted, "user:2:mfa")).toThrow(DecryptionError);
  });

  it("detects tampering", () => {
    const service = new FieldEncryptionService(config("v1", { v1: keyV1 }));
    const parts = service.encrypt("secret", "ctx").split(".");
    parts[3] = Buffer.from("tampered").toString("base64url");
    expect(() => service.decrypt(parts.join("."), "ctx")).toThrow(DecryptionError);
  });

  it("rejects truncated authentication tags", () => {
    const service = new FieldEncryptionService(config("v1", { v1: keyV1 }));
    const parts = service.encrypt("secret", "ctx").split(".");
    parts[2] = Buffer.from(parts[2]!, "base64url").subarray(0, 4).toString("base64url");
    expect(() => service.decrypt(parts.join("."), "ctx")).toThrow(DecryptionError);
  });

  it("decrypts older key versions after rotation and flags them", () => {
    const before = new FieldEncryptionService(config("v1", { v1: keyV1 }));
    const encrypted = before.encrypt("secret", "ctx");
    const after = new FieldEncryptionService(config("v2", { v1: keyV1, v2: keyV2 }));
    expect(after.decrypt(encrypted, "ctx")).toBe("secret");
    expect(after.needsRotation(encrypted)).toBe(true);
  });
});

describe("SecretHasherService", () => {
  const hasher = new SecretHasherService(config("v1", { v1: keyV1 }));

  it("produces codes of the requested shape", () => {
    expect(hasher.numericCode(8)).toMatch(/^\d{8}$/);
    expect(hasher.recoveryCode()).toMatch(/^[A-Z0-9]{5}-[A-Z0-9]{5}$/);
  });

  it("compares hashes in constant time and rejects different lengths", () => {
    const hash = hasher.keyedHash("value");
    expect(hasher.matches(hash, hasher.keyedHash("value"))).toBe(true);
    expect(hasher.matches(hash, hasher.keyedHash("other"))).toBe(false);
    expect(hasher.matches(hash, "abcd")).toBe(false);
  });
});
