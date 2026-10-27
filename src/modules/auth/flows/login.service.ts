import { Injectable } from "@nestjs/common";
import { type LoginInput, type MfaChallengeInput, type MfaRequiredResult, requiresMfa } from "../../../shared";

import type { RequestMeta } from "../../../common/auth/auth-principal";
import { Errors } from "../../../common/http/app-exception";
import { AuditService } from "../../../infrastructure/audit/audit.service";
import { FieldEncryptionService } from "../../../infrastructure/crypto/field-encryption.service";
import { ATTEMPT_POLICIES, AttemptLimiterService } from "../../../infrastructure/rate-limit/attempt-limiter.service";
import { MfaChallengeService } from "../mfa/mfa-challenge.service";
import { RecoveryCodeService } from "../mfa/recovery-code.service";
import { TotpService } from "../mfa/totp.service";
import { PasswordService } from "../password/password.service";
import { AccountEmailsService } from "./account-emails.service";
import { type IssuedAuthentication, SessionIssuerService } from "../sessions/session-issuer.service";
import { type UserRecord, UsersRepository } from "../users.repository";
import { isLocked, lockMinutesAfter } from "./lockout.policy";

export type LoginOutcome = { kind: "authenticated"; issued: IssuedAuthentication } | { kind: "mfa"; result: MfaRequiredResult };

export const mfaSecretContext = (userId: string) => `user:${userId}:mfa`;

@Injectable()
export class LoginService {
  constructor(
    private readonly accountEmails: AccountEmailsService,
    private readonly users: UsersRepository,
    private readonly passwords: PasswordService,
    private readonly issuer: SessionIssuerService,
    private readonly challenges: MfaChallengeService,
    private readonly totp: TotpService,
    private readonly recoveryCodes: RecoveryCodeService,
    private readonly encryption: FieldEncryptionService,
    private readonly limiter: AttemptLimiterService,
    private readonly audit: AuditService,
  ) {}

  async login(input: LoginInput, meta: RequestMeta): Promise<LoginOutcome> {
    await this.limiter.consume(ATTEMPT_POLICIES.loginPerAccountAndIp, `${input.email}:${meta.ip}`);
    const user = await this.users.findByEmail(input.email);
    if (!user || isLocked(user.lockedUntil, new Date())) {
      await this.passwords.burnEquivalentTime(input.password);
      throw Errors.invalidCredentials();
    }
    if (!(await this.passwords.verify(user.passwordHash, input.password))) {
      await this.recordFailure(user, meta);
      throw Errors.invalidCredentials();
    }
    this.assertCanSignIn(user);
    if (user.mfaEnrolledAt) {
      return { kind: "mfa", result: { status: "MFA_REQUIRED", challengeToken: await this.challenges.issue(user.id) } };
    }
    const mfaState = requiresMfa(user.role) ? "ENROLMENT_REQUIRED" : "NOT_REQUIRED";
    await this.users.resetFailures(user.id);
    const startedAt = new Date();
    const issued = await this.issuer.start(user.id, mfaState, meta);
    await this.recordSuccess(user, "auth.signed_in", meta);
    await this.accountEmails.afterSignIn(user, meta, false, startedAt);
    return { kind: "authenticated", issued };
  }

  async completeChallenge(input: MfaChallengeInput, meta: RequestMeta): Promise<IssuedAuthentication> {
    const { userId, challengeId } = await this.challenges.read(input.challengeToken);
    await this.limiter.consume(ATTEMPT_POLICIES.mfaPerUser, userId);
    await this.limiter.consume(ATTEMPT_POLICIES.mfaDailyPerUser, userId);
    const user = await this.users.findById(userId);
    if (!user?.mfaSecretEncrypted || isLocked(user.lockedUntil, new Date())) {
      throw Errors.unauthenticated("Sign in again to continue.");
    }
    this.assertCanSignIn(user);
    await this.challenges.markUsed(challengeId);
    const passed = input.code
      ? await this.totp.verifyOnce(user.id, this.encryption.decrypt(user.mfaSecretEncrypted, mfaSecretContext(user.id)), input.code)
      : await this.recoveryCodes.consume(user.id, input.recoveryCode ?? "");
    if (!passed) {
      await this.recordFailure(user, meta, "auth.mfa_failed");
      throw Errors.unauthenticated("That code didn't work. Sign in again to retry.");
    }
    await this.limiter.reset(ATTEMPT_POLICIES.mfaPerUser, user.id);
    await this.users.resetFailures(user.id);
    const startedAt = new Date();
    const issued = await this.issuer.start(user.id, "VERIFIED", meta);
    await this.recordSuccess(user, input.recoveryCode ? "auth.signed_in_recovery_code" : "auth.signed_in_mfa", meta);
    await this.accountEmails.afterSignIn(user, meta, !input.code, startedAt);
    return issued;
  }

  private assertCanSignIn(user: UserRecord): void {
    if (user.status === "PENDING_EMAIL_VERIFICATION") {
      throw Errors.emailNotVerified();
    }
    if (user.status !== "ACTIVE") {
      throw Errors.accountInactive();
    }
  }

  private async recordFailure(user: UserRecord, meta: RequestMeta, action = "auth.sign_in_failed"): Promise<void> {
    const failedLoginCount = await this.users.incrementFailures(user.id);
    const lockMinutes = lockMinutesAfter(failedLoginCount);
    const lockedUntil = lockMinutes ? new Date(Date.now() + lockMinutes * 60_000) : null;
    if (lockedUntil) {
      await this.users.update(user.id, { lockedUntil });
    }
    await this.audit.record({
      actor: { userId: user.id, role: user.role },
      action: lockMinutes ? "auth.account_locked" : action,
      resourceType: "user",
      resourceId: user.id,
      after: { failedLoginCount, lockedUntil },
      meta,
    });
    if (lockMinutes) {
      await this.accountEmails.locked(user.email, lockMinutes);
    }
  }

  private async recordSuccess(user: UserRecord, action: string, meta: RequestMeta): Promise<void> {
    await this.limiter.reset(ATTEMPT_POLICIES.loginPerAccountAndIp, `${user.email}:${meta.ip}`);
    await this.audit.record({ actor: { userId: user.id, role: user.role }, action, resourceType: "user", resourceId: user.id, vendorId: user.vendorId, meta });
  }
}
