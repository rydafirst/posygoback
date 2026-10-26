import { Inject, Injectable } from "@nestjs/common";

import type { RequestMeta } from "../../../common/auth/auth-principal";
import { Errors } from "../../../common/http/app-exception";
import { APP_CONFIG } from "../../../config/config.module";
import type { AppConfig } from "../../../config/config.schema";
import { PrismaService } from "../../../database/prisma.service";
import { SecretHasherService } from "../../../infrastructure/crypto/secret-hasher.service";
import { EMAIL_SENDER, type EmailSender } from "../../../infrastructure/email/email.port";
import { AttemptLimiterService } from "../../../infrastructure/rate-limit/attempt-limiter.service";
import type { BuyerView } from "../../../shared";
import { CommerceEmails } from "../commerce-emails";
import { BUYER_SESSION_DAYS } from "./buyer-cookie";

const LINK_MINUTES = 15;
const PER_EMAIL = { name: "buyer-link-email", limit: 5, windowSeconds: 60 * 60 };
const PER_IP = { name: "buyer-link-ip", limit: 20, windowSeconds: 60 * 60 };
const SESSION_PER_IP = { name: "buyer-session-ip", limit: 30, windowSeconds: 15 * 60 };

@Injectable()
export class BuyerAuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly hasher: SecretHasherService,
    private readonly limiter: AttemptLimiterService,
    @Inject(EMAIL_SENDER) private readonly email: EmailSender,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  async requestLink(email: string, meta: RequestMeta): Promise<void> {
    await this.limiter.consume(PER_IP, meta.ip);
    await this.limiter.consume(PER_EMAIL, email);
    const buyer = await this.prisma.buyerAccount.findUnique({ where: { email }, select: { id: true } });
    if (!buyer) {
      return;
    }
    const token = this.hasher.randomToken();
    await this.prisma.$transaction([
      this.prisma.buyerLoginToken.updateMany({ where: { buyerId: buyer.id, consumedAt: null }, data: { consumedAt: new Date() } }),
      this.prisma.buyerLoginToken.create({ data: { buyerId: buyer.id, tokenHash: this.hasher.keyedHash(token), expiresAt: new Date(Date.now() + LINK_MINUTES * 60 * 1000) } }),
    ]);
    const link = `${this.config.WEB_PUBLIC_URL}/account/sign-in#token=${encodeURIComponent(token)}`;
    void this.email.send(CommerceEmails.signInLink(email, link)).catch(() => undefined);
  }

  async startSession(token: string, meta: RequestMeta): Promise<{ sessionToken: string; buyer: BuyerView }> {
    await this.limiter.consume(SESSION_PER_IP, meta.ip);
    const now = new Date();
    const tokenHash = this.hasher.keyedHash(token);
    const sessionToken = this.hasher.randomToken();
    const buyer = await this.prisma.$transaction(async (tx) => {
      const consumed = await tx.buyerLoginToken.updateMany({ where: { tokenHash, consumedAt: null, expiresAt: { gt: now } }, data: { consumedAt: now } });
      if (consumed.count === 0) {
        return null;
      }
      const login = await tx.buyerLoginToken.findUniqueOrThrow({ where: { tokenHash }, include: { buyer: true } });
      await tx.buyerSession.create({ data: { buyerId: login.buyerId, tokenHash: this.hasher.keyedHash(sessionToken), expiresAt: new Date(now.getTime() + BUYER_SESSION_DAYS * 24 * 60 * 60 * 1000) } });
      return login.buyer;
    });
    if (!buyer) {
      throw Errors.unauthenticated("This sign-in link has expired or was already used. Ask for a new one.");
    }
    return { sessionToken, buyer: { email: buyer.email, name: buyer.name } };
  }

  async resolve(sessionToken: string): Promise<string | null> {
    const session = await this.prisma.buyerSession.findUnique({ where: { tokenHash: this.hasher.keyedHash(sessionToken) }, select: { buyerId: true, expiresAt: true, revokedAt: true } });
    return session && !session.revokedAt && session.expiresAt > new Date() ? session.buyerId : null;
  }

  async me(buyerId: string): Promise<BuyerView> {
    const buyer = await this.prisma.buyerAccount.findUniqueOrThrow({ where: { id: buyerId } });
    return { email: buyer.email, name: buyer.name };
  }

  async signOut(sessionToken: string | null): Promise<void> {
    if (sessionToken) {
      await this.prisma.buyerSession.updateMany({ where: { tokenHash: this.hasher.keyedHash(sessionToken), revokedAt: null }, data: { revokedAt: new Date() } });
    }
  }
}
