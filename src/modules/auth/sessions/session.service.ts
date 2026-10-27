import { Inject, Injectable } from "@nestjs/common";
import type Redis from "ioredis";

import type { RequestMeta } from "../../../common/auth/auth-principal";
import { Errors } from "../../../common/http/app-exception";
import { APP_CONFIG } from "../../../config/config.module";
import type { AppConfig } from "../../../config/config.schema";
import { type DatabaseClient, lockRow, PrismaService } from "../../../database/prisma.service";
import type { Session } from "../../../generated/prisma/client";
import { SecretHasherService } from "../../../infrastructure/crypto/secret-hasher.service";
import { REDIS } from "../../../infrastructure/redis/redis.module";
import type { MfaState } from "../../../shared";
import { decideRotation } from "./rotation.policy";

export type SessionRecord = Session;

export interface IssuedSession {
  session: SessionRecord;
  refreshToken: string;
}

const ACTIVE_CACHE_SECONDS = 30;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export class RefreshReuseDetected extends Error {
  constructor(readonly userId: string) {
    super("Refresh token reuse detected");
    this.name = "RefreshReuseDetected";
  }
}
const MAX_PREVIOUS_HASHES = 20;

@Injectable()
export class SessionService {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(REDIS) private readonly redis: Redis,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    private readonly hasher: SecretHasherService,
  ) {}

  async create(userId: string, mfaState: MfaState, meta: RequestMeta, client: DatabaseClient = this.prisma): Promise<IssuedSession> {
    const secret = this.hasher.randomToken();
    const session = await client.session.create({ data: { userId, mfaState, refreshTokenHash: this.hasher.sha256(secret), ip: meta.ip, userAgent: meta.userAgent, expiresAt: this.expiry() } });
    return { session, refreshToken: `${session.id}.${secret}` };
  }

  async rotate(cookieValue: string, meta: RequestMeta): Promise<IssuedSession> {
    const parsed = this.parseCookie(cookieValue);
    if (!parsed) {
      throw Errors.unauthenticated();
    }
    const outcome = await this.prisma.$transaction(async (tx) => {
      const session = (await lockRow(tx, "sessions", parsed.sessionId)) ? await tx.session.findUnique({ where: { id: parsed.sessionId } }) : null;
      if (!session) {
        return { decision: "INVALID" as const };
      }
      const decision = decideRotation(session, this.hasher.sha256(parsed.secret), new Date(), this.hasher);
      if (decision === "REUSE_DETECTED") {
        await this.revokeAllForUser(session.userId, "refresh_reuse", tx);
        return { decision, userId: session.userId };
      }
      if (decision !== "ROTATE") {
        return { decision };
      }
      const nextSecret = this.hasher.randomToken();
      const updated = await tx.session.update({
        where: { id: session.id },
        data: {
          refreshTokenHash: this.hasher.sha256(nextSecret),
          previousTokenHashes: [...session.previousTokenHashes, session.refreshTokenHash].slice(-MAX_PREVIOUS_HASHES),
          lastUsedAt: new Date(),
          expiresAt: this.expiry(),
          ip: meta.ip,
          userAgent: meta.userAgent,
        },
      });
      return { decision, issued: { session: updated, refreshToken: `${session.id}.${nextSecret}` } };
    });
    if (outcome.decision === "ROTATE" && outcome.issued) {
      return outcome.issued;
    }
    if (outcome.decision === "REUSE_DETECTED") {
      throw new RefreshReuseDetected(outcome.userId);
    }
    if (outcome.decision === "SUPERSEDED") {
      throw Errors.refreshSuperseded();
    }
    throw Errors.unauthenticated();
  }

  async revokeByCookie(cookieValue: string): Promise<void> {
    const parsed = this.parseCookie(cookieValue);
    if (!parsed) {
      return;
    }
    const session = await this.prisma.session.findUnique({ where: { id: parsed.sessionId }, select: { id: true, refreshTokenHash: true } });
    if (session && this.hasher.matches(session.refreshTokenHash, this.hasher.sha256(parsed.secret))) {
      await this.revoke(session.id, "logout");
    }
  }

  async assertActive(sessionId: string, userId: string): Promise<void> {
    const key = this.cacheKey(sessionId);
    const cached = await this.redis.get(key);
    if (cached === "revoked") {
      throw Errors.sessionRevoked();
    }
    if (cached === `active:${userId}`) {
      return;
    }
    const session = UUID_PATTERN.test(sessionId)
      ? await this.prisma.session.findUnique({ where: { id: sessionId }, select: { userId: true, revokedAt: true, expiresAt: true, user: { select: { status: true } } } })
      : null;
    const live = session?.userId === userId && !session.revokedAt && session.expiresAt > new Date() && session.user.status === "ACTIVE";
    if (!live) {
      await this.markRevokedInCache(sessionId);
      throw Errors.sessionRevoked();
    }
    const stored = await this.redis.set(key, `active:${userId}`, "EX", ACTIVE_CACHE_SECONDS, "NX");
    if (stored !== "OK" && (await this.redis.get(key)) === "revoked") {
      throw Errors.sessionRevoked();
    }
  }

  async revokeOthers(userId: string, keepSessionId: string, reason: string, client: DatabaseClient = this.prisma): Promise<void> {
    const revoked = await client.session.updateManyAndReturn({
      where: { userId, revokedAt: null, id: { not: keepSessionId } },
      data: { revokedAt: new Date(), revokedReason: reason },
      select: { id: true },
    });
    await Promise.all(revoked.map((session) => this.markRevokedInCache(session.id)));
  }

  async setMfaState(sessionId: string, mfaState: MfaState, client: DatabaseClient = this.prisma): Promise<void> {
    await client.session.update({ where: { id: sessionId }, data: { mfaState } });
  }

  async revoke(sessionId: string, reason: string): Promise<void> {
    await this.prisma.session.updateMany({ where: { id: sessionId, revokedAt: null }, data: { revokedAt: new Date(), revokedReason: reason } });
    await this.markRevokedInCache(sessionId);
  }

  async revokeAllForUser(userId: string, reason: string, client: DatabaseClient = this.prisma): Promise<void> {
    const revoked = await client.session.updateManyAndReturn({ where: { userId, revokedAt: null }, data: { revokedAt: new Date(), revokedReason: reason }, select: { id: true } });
    await Promise.all(revoked.map((session) => this.markRevokedInCache(session.id)));
  }

  private async markRevokedInCache(sessionId: string): Promise<void> {
    await this.redis.set(this.cacheKey(sessionId), "revoked", "EX", this.config.JWT_ACCESS_TTL_SECONDS);
  }

  private parseCookie(cookieValue: string): { sessionId: string; secret: string } | null {
    const [sessionId, secret] = cookieValue.split(".");
    if (!sessionId || !secret || !UUID_PATTERN.test(sessionId)) {
      return null;
    }
    return { sessionId, secret };
  }

  private cacheKey(sessionId: string): string {
    return `session:${sessionId}`;
  }

  private expiry(): Date {
    return new Date(Date.now() + this.config.REFRESH_TTL_DAYS * 24 * 60 * 60 * 1000);
  }
}
