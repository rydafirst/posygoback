import { Inject, Injectable } from "@nestjs/common";
import { argon2id, hash, verify } from "argon2";

import { Errors } from "../../../common/http/app-exception";
import { BREACHED_PASSWORD_CHECKER, type BreachedPasswordChecker } from "./breached-password.checker";

const HASH_OPTIONS = { type: argon2id, memoryCost: 65_536, timeCost: 3, parallelism: 1 } as const;

@Injectable()
export class PasswordService {
  private dummyHash?: Promise<string>;

  constructor(@Inject(BREACHED_PASSWORD_CHECKER) private readonly breachChecker: BreachedPasswordChecker) {}

  async hashNew(password: string): Promise<string> {
    if (await this.breachChecker.isBreached(password)) {
      throw Errors.validation({ password: ["This password has appeared in a data breach. Choose a different one."] });
    }
    return hash(password, HASH_OPTIONS);
  }

  async verify(passwordHash: string, password: string): Promise<boolean> {
    try {
      return await verify(passwordHash, password);
    } catch {
      return false;
    }
  }

  async burnEquivalentTime(password: string): Promise<void> {
    this.dummyHash ??= hash("timing-equaliser-password", HASH_OPTIONS);
    await this.verify(await this.dummyHash, password);
  }
}
