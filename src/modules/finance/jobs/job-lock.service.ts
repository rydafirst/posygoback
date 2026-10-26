import { randomUUID } from "node:crypto";

import { Inject, Injectable } from "@nestjs/common";
import type Redis from "ioredis";

import { REDIS } from "../../../infrastructure/redis/redis.module";

const RELEASE = "if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call('del', KEYS[1]) else return 0 end";

@Injectable()
export class JobLockService {
  constructor(@Inject(REDIS) private readonly redis: Redis) {}

  async runExclusive<T>(name: string, ttlMs: number, work: () => Promise<T>): Promise<T | null> {
    const key = `job-lock:${name}`;
    const token = randomUUID();
    if ((await this.redis.set(key, token, "PX", ttlMs, "NX")) !== "OK") {
      return null;
    }
    try {
      return await work();
    } finally {
      await this.redis.eval(RELEASE, 1, key, token);
    }
  }
}
