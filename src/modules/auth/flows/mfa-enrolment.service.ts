import { Inject, Injectable } from "@nestjs/common";
import { type MfaConfirmInput, type MfaEnrolmentComplete, type MfaEnrolmentStart, requiresMfa } from "../../../shared";

import type { AuthPrincipal, RequestMeta } from "../../../common/auth/auth-principal";
import { Errors } from "../../../common/http/app-exception";
import { PrismaService } from "../../../database/prisma.service";
import { AuditService } from "../../../infrastructure/audit/audit.service";
import { FieldEncryptionService } from "../../../infrastructure/crypto/field-encryption.service";
import { EMAIL_SENDER, type EmailSender } from "../../../infrastructure/email/email.port";
import { ATTEMPT_POLICIES, AttemptLimiterService } from "../../../infrastructure/rate-limit/attempt-limiter.service";
import { AuthEmails } from "../auth-emails";
import { VerificationCodeService } from "../codes/verification-code.service";
import { RecoveryCodeService } from "../mfa/recovery-code.service";
import { TotpService } from "../mfa/totp.service";
import { SessionIssuerService } from "../sessions/session-issuer.service";
import { SessionService } from "../sessions/session.service";
import { UsersRepository } from "../users.repository";
import { mfaSecretContext } from "./login.service";

const pendingContext = (userId: string) => `user:${userId}:mfa-pending`;

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
    if (requiresMfa(user.role)) {
      if (!input.emailCode) {
        throw Errors.validation({ emailCode: ["Enter the 8-digit code we emailed you"] });
      }
      await this.codes.consumeNumeric(user.id, "MFA_ENROLMENT", input.emailCode);
    }
    const secret = this.encryption.decrypt(user.mfaPendingSecretEncrypted, pendingContext(user.id));
    if (!(await this.totp.verifyOnce(user.id, secret, input.code))) {
      throw Errors.invalidCode();
    }
    const recoveryCodes = await this.prisma.$transaction(async (tx) => {
      await this.users.update(user.id, { mfaSecretEncrypted: this.encryption.encrypt(secret, mfaSecretContext(user.id)), mfaPendingSecretEncrypted: null, mfaEnrolledAt: new Date() }, tx);
      await this.sessions.setMfaState(principal.sessionId, "VERIFIED", tx);
      await this.sessions.revokeOthers(user.id, principal.sessionId, "mfa_enrolled", tx);
      await this.audit.record({ actor: { userId: user.id, role: user.role }, action: "auth.mfa_enrolled", resourceType: "user", resourceId: user.id, meta }, tx);
      return this.recoveryCodes.regenerate(user.id, tx);
    });
    await this.limiter.reset(ATTEMPT_POLICIES.mfaPerUser, user.id);
    await this.email.send(AuthEmails.mfaEnabled(user.email));
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
