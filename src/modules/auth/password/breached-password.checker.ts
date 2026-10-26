import { createHash } from "node:crypto";

import { Logger } from "@nestjs/common";

export interface BreachedPasswordChecker {
  isBreached(password: string): Promise<boolean>;
}

export const BREACHED_PASSWORD_CHECKER = Symbol("BREACHED_PASSWORD_CHECKER");

export class DisabledBreachChecker implements BreachedPasswordChecker {
  isBreached(): Promise<boolean> {
    return Promise.resolve(false);
  }
}

export class PwnedPasswordsChecker implements BreachedPasswordChecker {
  private readonly logger = new Logger(PwnedPasswordsChecker.name);

  async isBreached(password: string): Promise<boolean> {
    const digest = createHash("sha1").update(password).digest("hex").toUpperCase();
    const prefix = digest.slice(0, 5);
    const suffix = digest.slice(5);
    try {
      const response = await fetch(`https://api.pwnedpasswords.com/range/${prefix}`, { headers: { "Add-Padding": "true" }, signal: AbortSignal.timeout(2_000) });
      if (!response.ok) {
        return false;
      }
      const body = await response.text();
      return body.split("\n").some((line) => line.startsWith(suffix) && Number(line.split(":")[1]) > 0);
    } catch {
      this.logger.warn("Breached-password lookup unavailable; continuing without it");
      return false;
    }
  }
}
