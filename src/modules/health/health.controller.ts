import { Controller, Get, HttpException, HttpStatus, Inject } from "@nestjs/common";
import { SkipThrottle } from "@nestjs/throttler";
import type Redis from "ioredis";

import { Public } from "../../common/auth/decorators";
import { PrismaService } from "../../database/prisma.service";
import { REDIS } from "../../infrastructure/redis/redis.module";

@Public()
@SkipThrottle()
@Controller({ path: "health", version: "1" })
export class HealthController {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(REDIS) private readonly redis: Redis,
  ) {}

  @Get("live")
  live() {
    return { status: "ok" };
  }

  @Get("ready")
  async ready() {
    const [database, cache] = await Promise.allSettled([this.prisma.$queryRaw`SELECT 1`, this.redis.ping()]);
    const checks = { database: database.status === "fulfilled", cache: cache.status === "fulfilled" };
    if (!checks.database || !checks.cache) {
      throw new HttpException({ status: "unavailable", checks }, HttpStatus.SERVICE_UNAVAILABLE);
    }
    return { status: "ok", checks };
  }
}
