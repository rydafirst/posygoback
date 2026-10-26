import { createHash, createHmac, randomBytes, randomInt, timingSafeEqual } from "node:crypto";

import { Inject, Injectable } from "@nestjs/common";

import { APP_CONFIG } from "../../config/config.module";
import type { AppConfig } from "../../config/config.schema";

const RECOVERY_ALPHABET = "ABCDEFGHJKMNPQRSTVWXYZ23456789";

@Injectable()
export class SecretHasherService {
  private readonly indexKey: Buffer;

  constructor(@Inject(APP_CONFIG) config: AppConfig) {
    this.indexKey = Buffer.from(config.BLIND_INDEX_KEY, "base64");
  }

  keyedHash(value: string): string {
    return createHmac("sha256", this.indexKey).update(value).digest("hex");
  }

  sha256(value: string): string {
    return createHash("sha256").update(value).digest("hex");
  }

  matches(expectedHex: string, actualHex: string): boolean {
    const expected = Buffer.from(expectedHex, "hex");
    const actual = Buffer.from(actualHex, "hex");
    return expected.length === actual.length && timingSafeEqual(expected, actual);
  }

  randomToken(bytes = 32): string {
    return randomBytes(bytes).toString("base64url");
  }

  numericCode(length: number): string {
    return Array.from({ length }, () => randomInt(0, 10)).join("");
  }

  recoveryCode(): string {
    const pick = () => Array.from({ length: 5 }, () => RECOVERY_ALPHABET[randomInt(0, RECOVERY_ALPHABET.length)]).join("");
    return `${pick()}-${pick()}`;
  }
}
