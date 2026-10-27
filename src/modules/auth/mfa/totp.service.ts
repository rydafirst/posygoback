import { Inject, Injectable } from "@nestjs/common";
import type Redis from "ioredis";
import { authenticator } from "otplib";
import { toDataURL } from "qrcode";

import { REDIS } from "../../../infrastructure/redis/redis.module";
import { PLATFORM_NAME } from "../../../common/brand/brand";

const ISSUER = PLATFORM_NAME;
const STEP_SECONDS = 30;

authenticator.options = { window: 1, step: STEP_SECONDS };

export interface TotpEnrolmentMaterial {
  secret: string;
  otpauthUrl: string;
  qrCodeDataUrl: string;
}

@Injectable()
export class TotpService {
  constructor(@Inject(REDIS) private readonly redis: Redis) {}

  async createEnrolment(accountLabel: string): Promise<TotpEnrolmentMaterial> {
    const secret = authenticator.generateSecret(20);
    const otpauthUrl = authenticator.keyuri(accountLabel, ISSUER, secret);
    return { secret, otpauthUrl, qrCodeDataUrl: await toDataURL(otpauthUrl, { margin: 1, width: 220 }) };
  }

  async verifyOnce(userId: string, secret: string, code: string): Promise<boolean> {
    const delta = authenticator.checkDelta(code, secret);
    if (delta === null) {
      return false;
    }
    const step = Math.floor(Date.now() / 1000 / STEP_SECONDS) + delta;
    const firstUse = await this.redis.set(`mfa:used:${userId}:${step}`, "1", "EX", STEP_SECONDS * 3, "NX");
    return firstUse === "OK";
  }
}
