import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

import { Inject, Injectable } from "@nestjs/common";

import { APP_CONFIG } from "../../config/config.module";
import type { AppConfig } from "../../config/config.schema";

const ALGORITHM = "aes-256-gcm";
const IV_BYTES = 12;
const TAG_BYTES = 16;

export class DecryptionError extends Error {
  constructor() {
    super("Encrypted value could not be decrypted");
    this.name = "DecryptionError";
  }
}

@Injectable()
export class FieldEncryptionService {
  private readonly keys: Record<string, Buffer>;
  private readonly activeVersion: string;

  constructor(@Inject(APP_CONFIG) config: AppConfig) {
    this.keys = config.FIELD_ENCRYPTION_KEYS;
    this.activeVersion = config.FIELD_ENCRYPTION_ACTIVE_KEY;
  }

  encrypt(plaintext: string, context: string): string {
    const key = this.keyFor(this.activeVersion);
    const iv = randomBytes(IV_BYTES);
    const cipher = createCipheriv(ALGORITHM, key, iv, { authTagLength: TAG_BYTES });
    cipher.setAAD(Buffer.from(context));
    const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
    const tag = cipher.getAuthTag();
    return [this.activeVersion, iv, tag, ciphertext].map((part) => (typeof part === "string" ? part : part.toString("base64url"))).join(".");
  }

  decrypt(payload: string, context: string): string {
    const [version, iv, tag, ciphertext] = payload.split(".");
    if (!version || !iv || !tag || !ciphertext) {
      throw new DecryptionError();
    }
    const authTag = Buffer.from(tag, "base64url");
    const nonce = Buffer.from(iv, "base64url");
    if (authTag.length !== TAG_BYTES || nonce.length !== IV_BYTES) {
      throw new DecryptionError();
    }
    try {
      const decipher = createDecipheriv(ALGORITHM, this.keyFor(version), nonce, { authTagLength: TAG_BYTES });
      decipher.setAAD(Buffer.from(context));
      decipher.setAuthTag(authTag);
      return Buffer.concat([decipher.update(Buffer.from(ciphertext, "base64url")), decipher.final()]).toString("utf8");
    } catch {
      throw new DecryptionError();
    }
  }

  needsRotation(payload: string): boolean {
    return !payload.startsWith(`${this.activeVersion}.`);
  }

  private keyFor(version: string): Buffer {
    const key = this.keys[version];
    if (!key) {
      throw new DecryptionError();
    }
    return key;
  }
}
