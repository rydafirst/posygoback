import { Global, Inject, Module, type OnApplicationShutdown } from "@nestjs/common";
import Redis from "ioredis";

import { APP_CONFIG } from "../../config/config.module";
import type { AppConfig } from "../../config/config.schema";

export const REDIS = Symbol("REDIS");

@Global()
@Module({
  providers: [
    {
      provide: REDIS,
      inject: [APP_CONFIG],
      useFactory: async (config: AppConfig): Promise<Redis> => {
        const redis = new Redis(config.REDIS_URL, { maxRetriesPerRequest: 2, enableOfflineQueue: false, lazyConnect: true });
        await redis.connect();
        return redis;
      },
    },
  ],
  exports: [REDIS],
})
export class RedisModule implements OnApplicationShutdown {
  constructor(@Inject(REDIS) private readonly redis: Redis) {}

  async onApplicationShutdown(): Promise<void> {
    await this.redis.quit();
  }
}
