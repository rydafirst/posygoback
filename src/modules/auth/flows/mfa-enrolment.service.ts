import { Inject, Injectable } from "@nestjs/common";
import { type MfaConfirmInput, type MfaEnrolmentComplete, type MfaEnrolmentStart, requiresMfa } from "../../../shared";

import type { AuthPrincipal, RequestMeta } from "../../../common/auth/auth-principal";
import { Errors } from "../../../common/http/app-exception";
import { PrismaService } from "../../../database/prisma.service";
import { AuditService } from "../../../infrastructure/audit/audit.service";
import { FieldEncryptionService } from "../../../infrastructure/crypto/field-encryption.service";
import { EMAIL_SENDER, type EmailSender } from "../../../infrastructure/email/email.port";
import { ATTEMPT_POLICIES, AttemptLimiterService } from "../../../infrastructure/rate-limit/attempt-limiter.service";
import { PersonalNoticesService, securityPage } from "../../notifications/personal-notices.service";
import { AuthEmails } from "../auth-emails";
import { VerificationCodeService } from "../codes/verification-code.service";
import { RecoveryCodeService } from "../mfa/recovery-code.service";
import { TotpService } from "../mfa/totp.service";
import { SessionIssuerService } from "../sessions/session-issuer.service";
import { SessionService } from "../sessions/session.service";
import { UsersRepository } from "../users.repository";
import { mfaSecretContext } from "./login.service";

const pendingContext = (userId: string) => `user:${userId}:mfa-pending`;

const WRONG_EMAIL_CODE = "The email code isn't right or has expired. Use the newest one, or send a new code.";
const WRONG_APP_CODE = "The app code didn't work. Make sure you scanned the code on this page, then enter the newest one from your app.";

@Injectable()
export class MfaEnrolmentService {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(EMAIL_SENDER) private readonly email: EmailSender,
    private readonly users: UsersRepository,
    private readonly totp: TotpService,
    private readonly recoveryCodes: RecoveryCodeService,
    private readonly encryption: FieldEncryptionService,
    private readonly sessions: SessionService,
    private readonly issuer: SessionIssuerService,
    private readonly codes: VerificationCodeService,
    private readonly limiter: AttemptLimiterService,
    private readonly audit: AuditService,
    private readonly notices: PersonalNoticesService,
  ) {}

  async start(principal: AuthPrincipal): Promise<MfaEnrolmentStart> {
    const user = await this.requireUser(principal.userId);
    if (user.mfaEnrolledAt) {
      throw Errors.mfaAlreadyEnrolled();
    }
    await this.limiter.consume(ATTEMPT_POLICIES.mfaEnrolmentStart, user.id);
    const material = await this.totp.createEnrolment(user.email);
    await this.users.update(user.id, { mfaPendingSecretEncrypted: this.encryption.encrypt(material.secret, pendingContext(user.id)) });
    const emailCodeRequired = requiresMfa(user.role);
    if (emailCodeRequired) {
      const code = await this.codes.issueNumeric(user.id, "MFA_ENROLMENT");
      await this.email.send(AuthEmails.mfaEnrolmentCode(user.email, code));
    }
    return { ...material, emailCodeRequired };
  }

  async resendEmailCode(principal: AuthPrincipal): Promise<void> {
    const user = await this.requireUser(principal.userId);
    if (user.mfaEnrolledAt) {
      throw Errors.mfaAlreadyEnrolled();
    }
    if (!user.mfaPendingSecretEncrypted || !requiresMfa(user.role)) {
      throw Errors.invalidTransition("Start two-factor set-up first.");
    }
    await this.limiter.consume(ATTEMPT_POLICIES.mfaEnrolmentResend, user.id);
    const code = await this.codes.issueNumeric(user.id, "MFA_ENROLMENT");
    await this.email.send(AuthEmails.mfaEnrolmentCode(user.email, code));
  }

  async confirm(principal: AuthPrincipal, input: MfaConfirmInput, meta: RequestMeta): Promise<MfaEnrolmentComplete> {
    await this.limiter.consume(ATTEMPT_POLICIES.mfaPerUser, principal.userId);
    const user = await this.requireUser(principal.userId);
    if (user.mfaEnrolledAt) {
      throw Errors.mfaAlreadyEnrolled();
    }
    if (!user.mfaPendingSecretEncrypted) {
      throw Errors.invalidCode();
    }
    const emailCode = requiresMfa(user.role) ? input.emailCode : undefined;
    if (requiresMfa(user.role)) {
      if (!emailCode) {
        throw Errors.validation({ emailCode: ["Enter the 8-digit code we emailed you"] });
      }
      if (!(await this.codes.matchesNumeric(user.id, "MFA_ENROLMENT", emailCode))) {
        throw Errors.invalidCode(WRONG_EMAIL_CODE);
      }
    }
    const secret = this.encryption.decrypt(user.mfaPendingSecretEncrypted, pendingContext(user.id));
    if (!(await this.totp.verifyOnce(user.id, secret, input.code))) {
      throw Errors.invalidCode(WRONG_APP_CODE);
    }
    if (emailCode) {
      await this.codes.consumeNumeric(user.id, "MFA_ENROLMENT", emailCode).catch(() => {
        throw Errors.invalidCode(WRONG_EMAIL_CODE);
      });
    }
    const recoveryCodes = await this.prisma.$transaction(async (tx) => {
      await this.users.update(user.id, { mfaSecretEncrypted: this.encryption.encrypt(secret, mfaSecretContext(user.id)), mfaPendingSecretEncrypted: null, mfaEnrolledAt: new Date() }, tx);
      await this.sessions.setMfaState(principal.sessionId, "VERIFIED", tx);
      await this.sessions.revokeOthers(user.id, principal.sessionId, "mfa_enrolled", tx);
      await this.audit.record({ actor: { userId: user.id, role: user.role }, action: "auth.mfa_enrolled", resourceType: "user", resourceId: user.id, meta }, tx);
      return this.recoveryCodes.regenerate(user.id, tx);
    });
    await this.limiter.reset(ATTEMPT_POLICIES.mfaPerUser, user.id);
    await this.notices.send(AuthEmails.mfaEnabled(user.email), securityPage);
    const authenticated = await this.issuer.authenticate(user.id, principal.sessionId, "VERIFIED");
    return { recoveryCodes, accessToken: authenticated.accessToken, user: authenticated.user };
  }

  private async requireUser(userId: string) {
    const user = await this.users.findById(userId);
    if (!user) {
      throw Errors.unauthenticated();
    }
    return user;
  }
}
