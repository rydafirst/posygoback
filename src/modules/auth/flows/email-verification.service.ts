import { Inject, Injectable } from "@nestjs/common";
import type { VerifyEmailInput } from "../../../shared";

import type { RequestMeta } from "../../../common/auth/auth-principal";
import { Errors } from "../../../common/http/app-exception";
import { PrismaService } from "../../../database/prisma.service";
import { AuditService } from "../../../infrastructure/audit/audit.service";
import { EMAIL_SENDER, type EmailSender } from "../../../infrastructure/email/email.port";
import { ATTEMPT_POLICIES, AttemptLimiterService } from "../../../infrastructure/rate-limit/attempt-limiter.service";
import { AuthEmails } from "../auth-emails";
import { VerificationCodeService } from "../codes/verification-code.service";
import { PasswordService } from "../password/password.service";
import { AccountEmailsService } from "./account-emails.service";
import { type IssuedAuthentication, SessionIssuerService } from "../sessions/session-issuer.service";
import { UsersRepository } from "../users.repository";

@Injectable()
export class EmailVerificationService {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(EMAIL_SENDER) private readonly email: EmailSender,
    private readonly users: UsersRepository,
    private readonly codes: VerificationCodeService,
    private readonly passwords: PasswordService,
    private readonly issuer: SessionIssuerService,
    private readonly accountEmails: AccountEmailsService,
    private readonly limiter: AttemptLimiterService,
    private readonly audit: AuditService,
  ) {}

  async verify(input: VerifyEmailInput, meta: RequestMeta): Promise<IssuedAuthentication> {
    await this.limiter.consume(ATTEMPT_POLICIES.verifyPerAccountAndIp, `${input.email}:${meta.ip}`);
    const user = await this.users.findByEmail(input.email);
    if (!user || user.status !== "PENDING_EMAIL_VERIFICATION") {
      await this.passwords.burnEquivalentTime(input.password);
      throw Errors.invalidCode();
    }
    if (!(await this.passwords.verify(user.passwordHash, input.password))) {
      throw Errors.invalidCode();
    }
    await this.codes.consumeNumeric(user.id, "EMAIL_VERIFICATION", input.code);
    await this.prisma.$transaction(async (tx) => {
      await this.users.update(user.id, { status: "ACTIVE", emailVerifiedAt: new Date() }, tx);
      await this.audit.record(
        { actor: { userId: user.id, role: user.role }, action: "auth.email_verified", resourceType: "user", resourceId: user.id, vendorId: user.vendorId, countryCode: user.countryCode, meta },
        tx,
      );
    });
    const issued = await this.issuer.start(user.id, "NOT_REQUIRED", meta);
    await this.accountEmails.welcome(user.id);
    return issued;
  }

  async resend(email: string, meta: RequestMeta): Promise<void> {
    await this.limiter.consume(ATTEMPT_POLICIES.resendPerIp, meta.ip);
    await this.limiter.consume(ATTEMPT_POLICIES.resendPerAccount, email);
    const user = await this.users.findByEmail(email);
    if (user?.status !== "PENDING_EMAIL_VERIFICATION") {
      return;
    }
    const code = await this.codes.issueNumeric(user.id, "EMAIL_VERIFICATION");
    await this.email.send(AuthEmails.verifyEmail(user.email, code));
  }
}
