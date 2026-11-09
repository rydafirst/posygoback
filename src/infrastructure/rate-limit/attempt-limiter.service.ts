import { Inject, Injectable } from "@nestjs/common";
import type Redis from "ioredis";

import { Errors } from "../../common/http/app-exception";
import { REDIS } from "../redis/redis.module";

export interface AttemptPolicy {
  name: string;
  limit: number;
  windowSeconds: number;
  message?: string;
}

const IDENTITY_STARTS_MESSAGE = "You've started 5 ID checks today. Try again in 24 hours, or contact us if you're stuck.";

export const ATTEMPT_POLICIES = {
  vendorIdentityStarts: { name: "vendor-identity-starts", limit: 5, windowSeconds: 24 * 60 * 60, message: IDENTITY_STARTS_MESSAGE },
  partnerIdentityStarts: { name: "partner-identity-starts", limit: 5, windowSeconds: 24 * 60 * 60, message: IDENTITY_STARTS_MESSAGE },
  loginPerAccountAndIp: { name: "login-account-ip", limit: 10, windowSeconds: 15 * 60 },
  verifyPerAccountAndIp: { name: "verify-account-ip", limit: 10, windowSeconds: 15 * 60 },
  resendPerAccount: { name: "resend-account", limit: 5, windowSeconds: 60 * 60 },
  resendPerIp: { name: "resend-ip", limit: 10, windowSeconds: 60 * 60 },
  resetPerAccount: { name: "reset-account", limit: 5, windowSeconds: 60 * 60 },
  resetPerIp: { name: "reset-ip", limit: 10, windowSeconds: 60 * 60 },
  mfaPerUser: { name: "mfa-user", limit: 5, windowSeconds: 5 * 60 },
  mfaDailyPerUser: { name: "mfa-user-daily", limit: 30, windowSeconds: 24 * 60 * 60 },
  mfaEnrolmentStart: { name: "mfa-enrolment-start", limit: 5, windowSeconds: 60 * 60 },
  mfaEnrolmentResend: { name: "mfa-enrolment-resend", limit: 5, windowSeconds: 60 * 60 },
  signupPerIp: { name: "signup-ip", limit: 10, windowSeconds: 60 * 60 },
  signupPerEmail: { name: "signup-email", limit: 5, windowSeconds: 60 * 60 },
  accountChangePerUser: { name: "account-change-user", limit: 10, windowSeconds: 60 * 60 },
} satisfies Record<string, AttemptPolicy>;

@Injectable()
export class AttemptLimiterService {
  constructor(@Inject(REDIS) private readonly redis: Redis) {}

  async consume(policy: AttemptPolicy, subject: string): Promise<void> {
    const key = this.key(policy, subject);
    const [[, count]] = (await this.redis.multi().incr(key).expire(key, policy.windowSeconds, "NX").exec()) as [[Error | null, number]];
    if (count > policy.limit) {
      throw Errors.rateLimited(policy.message);
    }
  }

  async spend<Result>(policy: AttemptPolicy, subject: string, work: () => Promise<Result>): Promise<Result> {
    await this.consume(policy, subject);
    try {
      return await work();
    } catch (error) {
      await this.release(policy, subject);
      throw error;
    }
  }

  private async release(policy: AttemptPolicy, subject: string): Promise<void> {
    const key = this.key(policy, subject);
    if ((await this.redis.decr(key)) <= 0) {
      await this.redis.del(key);
    }
  }

  async reset(policy: AttemptPolicy, subject: string): Promise<void> {
    await this.redis.del(this.key(policy, subject));
  }

  private key(policy: AttemptPolicy, subject: string): string {
    return `attempts:${policy.name}:${subject}`;
  }
}
