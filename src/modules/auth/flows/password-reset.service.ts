import { Inject, Injectable } from "@nestjs/common";
import type { ResetPasswordInput } from "../../../shared";

import type { RequestMeta } from "../../../common/auth/auth-principal";
import { Errors } from "../../../common/http/app-exception";
import { APP_CONFIG } from "../../../config/config.module";
import type { AppConfig } from "../../../config/config.schema";
import { PrismaService } from "../../../database/prisma.service";
import { AuditService } from "../../../infrastructure/audit/audit.service";
import { EMAIL_SENDER, type EmailSender } from "../../../infrastructure/email/email.port";
import { ATTEMPT_POLICIES, AttemptLimiterService } from "../../../infrastructure/rate-limit/attempt-limiter.service";
import { AuthEmails } from "../auth-emails";
import { VerificationCodeService } from "../codes/verification-code.service";
import { PasswordService } from "../password/password.service";
import { SessionService } from "../sessions/session.service";
import { UsersRepository } from "../users.repository";

@Injectable()
export class PasswordResetService {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(EMAIL_SENDER) private readonly email: EmailSender,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    private readonly users: UsersRepository,
    private readonly passwords: PasswordService,
    private readonly codes: VerificationCodeService,
    private readonly sessions: SessionService,
    private readonly limiter: AttemptLimiterService,
    private readonly audit: AuditService,
  ) {}

  async request(email: string, meta: RequestMeta): Promise<void> {
    await this.limiter.consume(ATTEMPT_POLICIES.resetPerAccount, email);
    await this.limiter.consume(ATTEMPT_POLICIES.resetPerIp, meta.ip);
    const user = await this.users.findByEmail(email);
    if (!user || user.status === "CLOSED" || user.status === "SUSPENDED") {
      return;
    }
    const token = await this.codes.issueToken(user.id, "PASSWORD_RESET");
    const link = `${this.config.WEB_PUBLIC_URL}/reset-password#token=${encodeURIComponent(token)}`;
    await this.email.send(AuthEmails.passwordReset(user.email, link));
  }

  async reset(input: ResetPasswordInput, meta: RequestMeta): Promise<void> {
    const passwordHash = await this.passwords.hashNew(input.password);
    const user = await this.prisma.$transaction(async (tx) => {
      const userId = await this.codes.consumeToken("PASSWORD_RESET", input.token, tx);
      const found = userId ? await this.users.findById(userId, tx) : undefined;
      if (!found) {
        return undefined;
      }
      await this.users.update(
        found.id,
        {
          passwordHash,
          passwordChangedAt: new Date(),
          failedLoginCount: 0,
          lockedUntil: null,
          ...(found.status === "PENDING_EMAIL_VERIFICATION" ? { status: "ACTIVE" as const, emailVerifiedAt: new Date() } : {}),
        },
        tx,
      );
      await this.sessions.revokeAllForUser(found.id, "password_reset", tx);
      await this.audit.record({ actor: { userId: found.id, role: found.role }, action: "auth.password_reset", resourceType: "user", resourceId: found.id, meta }, tx);
      return found;
    });
    if (!user) {
      throw Errors.invalidCode();
    }
    await this.email.send(AuthEmails.passwordChanged(user.email));
  }
}
