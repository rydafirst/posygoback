import { Inject, Injectable } from "@nestjs/common";

import type { AuthPrincipal, RequestMeta } from "../../../common/auth/auth-principal";
import { Errors } from "../../../common/http/app-exception";
import { APP_CONFIG } from "../../../config/config.module";
import type { AppConfig } from "../../../config/config.schema";
import { PrismaService } from "../../../database/prisma.service";
import type { User } from "../../../generated/prisma/client";
import { AuditService } from "../../../infrastructure/audit/audit.service";
import { EMAIL_SENDER, type EmailSender } from "../../../infrastructure/email/email.port";
import { ATTEMPT_POLICIES, AttemptLimiterService } from "../../../infrastructure/rate-limit/attempt-limiter.service";
import type { AccountView, ChangeEmailInput, ChangePasswordInput } from "../../../shared";
import { PersonalNoticesService, securityPage } from "../../notifications/personal-notices.service";
import { AuthEmails } from "../auth-emails";
import { VerificationCodeService } from "../codes/verification-code.service";
import { PasswordService } from "../password/password.service";
import { SessionService } from "../sessions/session.service";
import { UsersRepository } from "../users.repository";

@Injectable()
export class AccountChangesService {
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
    private readonly notices: PersonalNoticesService,
  ) {}

  async view(principal: AuthPrincipal): Promise<AccountView> {
    const user = await this.users.findById(principal.userId);
    if (!user) {
      throw Errors.notFound();
    }
    return { email: user.email, pendingEmail: user.pendingEmail };
  }

  async changePassword(principal: AuthPrincipal, input: ChangePasswordInput, meta: RequestMeta): Promise<void> {
    const user = await this.confirmedUser(principal, input.currentPassword);
    if (await this.passwords.verify(user.passwordHash, input.password)) {
      throw Errors.validation({ password: ["Choose a password you haven't used here before"] });
    }
    const passwordHash = await this.passwords.hashNew(input.password);
    await this.prisma.$transaction(async (tx) => {
      await this.users.update(user.id, { passwordHash, passwordChangedAt: new Date() }, tx);
      await this.sessions.revokeOthers(user.id, principal.sessionId, "password_changed", tx);
      await this.audit.record({ actor: { userId: user.id, role: user.role }, action: "auth.password_changed", resourceType: "user", resourceId: user.id, meta }, tx);
    });
    await this.notices.send(AuthEmails.passwordChanged(user.email, this.config.WEB_PUBLIC_URL), securityPage);
  }

  async requestEmailChange(principal: AuthPrincipal, input: ChangeEmailInput, meta: RequestMeta): Promise<AccountView> {
    const user = await this.confirmedUser(principal, input.currentPassword);
    if (input.email === user.email) {
      throw Errors.validation({ email: ["This is already your email"] });
    }
    if (await this.users.findByEmail(input.email)) {
      throw Errors.validation({ email: ["Another account uses this email"] });
    }
    await this.prisma.$transaction(async (tx) => {
      await this.users.update(user.id, { pendingEmail: input.email }, tx);
      await this.audit.record(
        { actor: { userId: user.id, role: user.role }, action: "auth.email_change_requested", resourceType: "user", resourceId: user.id, after: { pendingEmail: input.email }, meta },
        tx,
      );
    });
    const token = await this.codes.issueToken(user.id, "EMAIL_CHANGE");
    await this.email.send(AuthEmails.confirmNewEmail(input.email, `${this.config.WEB_PUBLIC_URL}/confirm-email#token=${encodeURIComponent(token)}`));
    await this.notices.send(AuthEmails.emailChangeRequested(user.email, input.email, this.config.WEB_PUBLIC_URL), securityPage);
    return { email: user.email, pendingEmail: input.email };
  }

  async cancelEmailChange(principal: AuthPrincipal, meta: RequestMeta): Promise<AccountView> {
    const user = await this.prisma.$transaction(async (tx) => {
      const found = await this.users.findById(principal.userId, tx);
      if (!found) {
        throw Errors.notFound();
      }
      await this.users.update(found.id, { pendingEmail: null }, tx);
      await tx.verificationCode.updateMany({ where: { userId: found.id, purpose: "EMAIL_CHANGE", consumedAt: null }, data: { consumedAt: new Date() } });
      await this.audit.record({ actor: { userId: found.id, role: found.role }, action: "auth.email_change_cancelled", resourceType: "user", resourceId: found.id, meta }, tx);
      return found;
    });
    return { email: user.email, pendingEmail: null };
  }

  async confirmEmailChange(token: string, meta: RequestMeta): Promise<void> {
    const change = await this.prisma.$transaction(async (tx) => {
      const userId = await this.codes.consumeToken("EMAIL_CHANGE", token, tx);
      const user = userId ? await this.users.findById(userId, tx) : undefined;
      if (!user?.pendingEmail) {
        return undefined;
      }
      if (await tx.user.findUnique({ where: { email: user.pendingEmail }, select: { id: true } })) {
        await this.users.update(user.id, { pendingEmail: null }, tx);
        return null;
      }
      await tx.user.update({ where: { id: user.id }, data: { email: user.pendingEmail, pendingEmail: null, emailVerifiedAt: new Date() } });
      await this.sessions.revokeAllForUser(user.id, "email_changed", tx);
      await this.audit.record(
        {
          actor: { userId: user.id, role: user.role },
          action: "auth.email_changed",
          resourceType: "user",
          resourceId: user.id,
          before: { email: user.email },
          after: { email: user.pendingEmail },
          meta,
        },
        tx,
      );
      return { previous: user.email, current: user.pendingEmail };
    });
    if (change === null) {
      throw Errors.invalidCode("Another account started using that email first. Choose a different one.");
    }
    if (!change) {
      throw Errors.invalidCode("This link has expired or was already used.");
    }
    await this.email.send(AuthEmails.emailChanged(change.previous, change.current, this.config.WEB_PUBLIC_URL));
    await this.notices.send(AuthEmails.emailChanged(change.current, change.current, this.config.WEB_PUBLIC_URL), securityPage);
  }

  private async confirmedUser(principal: AuthPrincipal, currentPassword: string): Promise<User> {
    await this.limiter.consume(ATTEMPT_POLICIES.accountChangePerUser, principal.userId);
    const user = await this.users.findById(principal.userId);
    if (!user) {
      throw Errors.notFound();
    }
    if (!(await this.passwords.verify(user.passwordHash, currentPassword))) {
      throw Errors.validation({ currentPassword: ["That isn't your current password"] });
    }
    return user;
  }
}
