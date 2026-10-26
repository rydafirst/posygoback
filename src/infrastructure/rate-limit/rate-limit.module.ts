import { ThrottlerStorageRedisService } from "@nest-lab/throttler-storage-redis";
import { Global, Module } from "@nestjs/common";
import { ThrottlerModule } from "@nestjs/throttler";
import type Redis from "ioredis";

import { REDIS } from "../redis/redis.module";
import { AttemptLimiterService } from "./attempt-limiter.service";

export const THROTTLE = {
  auth: { default: { limit: 10, ttl: 60_000 } },
  authStrict: { default: { limit: 5, ttl: 60_000 } },
  session: { default: { limit: 60, ttl: 60_000 } },
  publicRead: { default: { limit: 60, ttl: 60_000 } },
  uploads: { default: { limit: 20, ttl: 60_000 } },
} as const;

@Global()
@Module({
  imports: [
    ThrottlerModule.forRootAsync({ inject: [REDIS], useFactory: (redis: Redis) => ({ throttlers: [{ name: "default", limit: 120, ttl: 60_000 }], storage: new ThrottlerStorageRedisService(redis) }) }),
  ],
  providers: [AttemptLimiterService],
  exports: [AttemptLimiterService],
})
export class RateLimitModule {}
