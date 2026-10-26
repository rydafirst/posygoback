import { randomUUID } from "node:crypto";

import { Inject, Injectable } from "@nestjs/common";
import { JwtService } from "@nestjs/jwt";
import type Redis from "ioredis";
import { z } from "zod";

import { Errors } from "../../../common/http/app-exception";
import { APP_CONFIG } from "../../../config/config.module";
import type { AppConfig } from "../../../config/config.schema";
import { REDIS } from "../../../infrastructure/redis/redis.module";

const LIFETIME_SECONDS = 300;
const AUDIENCE = "gfn-mfa";

const challengeClaims = z.object({ typ: z.literal("mfa_challenge"), sub: z.string().uuid(), jti: z.string().uuid() });

@Injectable()
export class MfaChallengeService {
  constructor(
    private readonly jwt: JwtService,
    @Inject(REDIS) private readonly redis: Redis,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  issue(userId: string): Promise<string> {
    return this.jwt.signAsync(
      { typ: "mfa_challenge" },
      { subject: userId, jwtid: randomUUID(), secret: this.config.MFA_CHALLENGE_SECRET, expiresIn: LIFETIME_SECONDS, audience: AUDIENCE, algorithm: "HS256" },
    );
  }

  async read(token: string): Promise<{ userId: string; challengeId: string }> {
    try {
      const claims = challengeClaims.parse(await this.jwt.verifyAsync(token, { secret: this.config.MFA_CHALLENGE_SECRET, audience: AUDIENCE, algorithms: ["HS256"] }));
      if (await this.redis.exists(this.key(claims.jti))) {
        throw Errors.unauthenticated("This sign-in attempt has already been used.");
      }
      return { userId: claims.sub, challengeId: claims.jti };
    } catch {
      throw Errors.unauthenticated("Your sign-in attempt expired. Sign in again.");
    }
  }

  async markUsed(challengeId: string): Promise<void> {
    const first = await this.redis.set(this.key(challengeId), "1", "EX", LIFETIME_SECONDS, "NX");
    if (first !== "OK") {
      throw Errors.unauthenticated("This sign-in attempt has already been used.");
    }
  }

  private key(challengeId: string): string {
    return `mfa:challenge:${challengeId}`;
  }
}
