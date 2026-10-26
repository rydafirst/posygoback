import { Inject, Injectable } from "@nestjs/common";
import type { AuthenticatedResult, LoginInput } from "../../../shared";

import type { AuthPrincipal, RequestMeta } from "../../../common/auth/auth-principal";
import { Errors } from "../../../common/http/app-exception";
import { APP_CONFIG } from "../../../config/config.module";
import type { AppConfig } from "../../../config/config.schema";
import { PrismaService } from "../../../database/prisma.service";
import { AuditService } from "../../../infrastructure/audit/audit.service";
import { ATTEMPT_POLICIES, AttemptLimiterService } from "../../../infrastructure/rate-limit/attempt-limiter.service";
import { PasswordService } from "../password/password.service";
import { type IssuedAuthentication, SessionIssuerService } from "../sessions/session-issuer.service";
import { SessionService } from "../sessions/session.service";
import { UsersRepository } from "../users.repository";

@Injectable()
export class TestShortcutsService {
  constructor(
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    private readonly prisma: PrismaService,
    private readonly users: UsersRepository,
    private readonly passwords: PasswordService,
    private readonly issuer: SessionIssuerService,
    private readonly sessions: SessionService,
    private readonly limiter: AttemptLimiterService,
    private readonly audit: AuditService,
  ) {}

  get enabled(): boolean {
    return this.config.AUTH_TEST_SHORTCUTS;
  }

  async skipEmailVerification(input: LoginInput, meta: RequestMeta): Promise<IssuedAuthentication> {
    this.assertEnabled();
    await this.limiter.consume(ATTEMPT_POLICIES.verifyPerAccountAndIp, `${input.email}:${meta.ip}`);
    const user = await this.users.findByEmail(input.email);
    if (!user || user.status !== "PENDING_EMAIL_VERIFICATION") {
      await this.passwords.burnEquivalentTime(input.password);
      throw Errors.invalidCredentials();
    }
    if (!(await this.passwords.verify(user.passwordHash, input.password))) {
      throw Errors.invalidCredentials();
    }
    await this.prisma.$transaction(async (tx) => {
      await this.users.update(user.id, { status: "ACTIVE", emailVerifiedAt: new Date() }, tx);
      await this.audit.record(
        { actor: { userId: user.id, role: user.role }, action: "auth.email_check_skipped", resourceType: "user", resourceId: user.id, vendorId: user.vendorId, countryCode: user.countryCode, meta },
        tx,
      );
    });
    return this.issuer.start(user.id, "NOT_REQUIRED", meta);
  }

  async skipMfaEnrolment(principal: AuthPrincipal, meta: RequestMeta): Promise<AuthenticatedResult> {
    this.assertEnabled();
    if (principal.mfaState !== "ENROLMENT_REQUIRED") {
      throw Errors.notFound();
    }
    await this.prisma.$transaction(async (tx) => {
      await this.sessions.setMfaState(principal.sessionId, "VERIFIED", tx);
      await this.audit.record({ actor: { userId: principal.userId, role: principal.role }, action: "auth.mfa_setup_skipped", resourceType: "user", resourceId: principal.userId, meta }, tx);
    });
    return this.issuer.authenticate(principal.userId, principal.sessionId, "VERIFIED");
  }

  private assertEnabled(): void {
    if (!this.enabled) {
      throw Errors.notFound();
    }
  }
}
