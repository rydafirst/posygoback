import { Body, Controller, Get, HttpCode, HttpStatus, Inject, Post, Req, Res, UseGuards } from "@nestjs/common";
import { Throttle } from "@nestjs/throttler";
import {
  type AuthenticatedResult,
  emailOnlySchema,
  type LoginInput,
  type LoginResult,
  loginSchema,
  type MfaChallengeInput,
  mfaChallengeSchema,
  type ResetPasswordInput,
  resetPasswordSchema,
  type SessionUser,
  type SignupInput,
  signupSchema,
  type VerifyEmailInput,
  verifyEmailSchema,
} from "../../shared";
import type { Request, Response } from "express";

import type { AuthPrincipal, RequestMeta } from "../../common/auth/auth-principal";
import { AllowPendingMfa, CurrentPrincipal, Meta, Public } from "../../common/auth/decorators";
import { TrustedOriginGuard } from "../../common/auth/trusted-origin.guard";
import { Errors } from "../../common/http/app-exception";
import { ZodValidationPipe } from "../../common/http/zod-validation.pipe";
import { APP_CONFIG } from "../../config/config.module";
import type { AppConfig } from "../../config/config.schema";
import { EMAIL_SENDER, type EmailSender } from "../../infrastructure/email/email.port";
import { THROTTLE } from "../../infrastructure/rate-limit/rate-limit.module";
import { AuthEmails } from "./auth-emails";
import { EmailVerificationService } from "./flows/email-verification.service";
import { LoginService } from "./flows/login.service";
import { PasswordResetService } from "./flows/password-reset.service";
import { SignupService } from "./flows/signup.service";
import { TestShortcutsService } from "./flows/test-shortcuts.service";
import { type IssuedAuthentication, SessionIssuerService } from "./sessions/session-issuer.service";
import { RefreshReuseDetected, SessionService } from "./sessions/session.service";
import { clearRefreshCookie, readRefreshCookie, setRefreshCookie } from "./tokens/refresh-cookie";
import { UsersRepository } from "./users.repository";

@Controller({ path: "auth", version: "1" })
export class AuthController {
  constructor(
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    @Inject(EMAIL_SENDER) private readonly email: EmailSender,
    private readonly signups: SignupService,
    private readonly verification: EmailVerificationService,
    private readonly logins: LoginService,
    private readonly resets: PasswordResetService,
    private readonly issuer: SessionIssuerService,
    private readonly sessions: SessionService,
    private readonly users: UsersRepository,
    private readonly shortcuts: TestShortcutsService,
  ) {}

  @Public()
  @Throttle(THROTTLE.authStrict)
  @Post("signup")
  @HttpCode(HttpStatus.ACCEPTED)
  signup(@Body(new ZodValidationPipe(signupSchema)) input: SignupInput, @Meta() meta: RequestMeta) {
    return this.signups.signup(input, meta);
  }

  @Public()
  @Throttle(THROTTLE.auth)
  @Post("verify-email")
  @HttpCode(HttpStatus.OK)
  async verifyEmail(@Body(new ZodValidationPipe(verifyEmailSchema)) input: VerifyEmailInput, @Meta() meta: RequestMeta, @Res({ passthrough: true }) response: Response): Promise<AuthenticatedResult> {
    return this.respond(await this.verification.verify(input, meta), response);
  }

  @Public()
  @Throttle(THROTTLE.session)
  @Get("test-shortcuts")
  testShortcuts() {
    return { enabled: this.shortcuts.enabled };
  }

  @Public()
  @Throttle(THROTTLE.auth)
  @Post("test-shortcuts/verify-email")
  @HttpCode(HttpStatus.OK)
  async skipEmailCheck(@Body(new ZodValidationPipe(loginSchema)) input: LoginInput, @Meta() meta: RequestMeta, @Res({ passthrough: true }) response: Response): Promise<AuthenticatedResult> {
    return this.respond(await this.shortcuts.skipEmailVerification(input, meta), response);
  }

  @Public()
  @Throttle(THROTTLE.authStrict)
  @Post("resend-verification")
  @HttpCode(HttpStatus.ACCEPTED)
  async resend(@Body(new ZodValidationPipe(emailOnlySchema)) input: { email: string }, @Meta() meta: RequestMeta) {
    await this.verification.resend(input.email, meta);
    return { status: "SENT_IF_PENDING" };
  }

  @Public()
  @Throttle(THROTTLE.authStrict)
  @Post("login")
  @HttpCode(HttpStatus.OK)
  async login(@Body(new ZodValidationPipe(loginSchema)) input: LoginInput, @Meta() meta: RequestMeta, @Res({ passthrough: true }) response: Response): Promise<LoginResult> {
    const outcome = await this.logins.login(input, meta);
    return outcome.kind === "mfa" ? outcome.result : this.respond(outcome.issued, response);
  }

  @Public()
  @Throttle(THROTTLE.auth)
  @Post("mfa/challenge")
  @HttpCode(HttpStatus.OK)
  async mfaChallenge(
    @Body(new ZodValidationPipe(mfaChallengeSchema)) input: MfaChallengeInput,
    @Meta() meta: RequestMeta,
    @Res({ passthrough: true }) response: Response,
  ): Promise<AuthenticatedResult> {
    return this.respond(await this.logins.completeChallenge(input, meta), response);
  }

  @Public()
  @UseGuards(TrustedOriginGuard)
  @Throttle(THROTTLE.session)
  @Post("refresh")
  @HttpCode(HttpStatus.OK)
  async refresh(@Req() request: Request, @Meta() meta: RequestMeta, @Res({ passthrough: true }) response: Response): Promise<AuthenticatedResult> {
    const cookie = readRefreshCookie(request);
    if (!cookie) {
      throw Errors.unauthenticated();
    }
    try {
      return this.respond(await this.issuer.refresh(cookie, meta), response);
    } catch (error) {
      if (error instanceof RefreshReuseDetected) {
        clearRefreshCookie(response, this.config);
        await this.notifyTheft(error.userId);
        throw Errors.sessionRevoked();
      }
      throw error;
    }
  }

  @Public()
  @UseGuards(TrustedOriginGuard)
  @Post("logout")
  @HttpCode(HttpStatus.NO_CONTENT)
  async logout(@Req() request: Request, @Res({ passthrough: true }) response: Response): Promise<void> {
    const cookie = readRefreshCookie(request);
    if (cookie) {
      await this.sessions.revokeByCookie(cookie);
    }
    clearRefreshCookie(response, this.config);
  }

  @Public()
  @Throttle(THROTTLE.authStrict)
  @Post("forgot-password")
  @HttpCode(HttpStatus.ACCEPTED)
  async forgotPassword(@Body(new ZodValidationPipe(emailOnlySchema)) input: { email: string }, @Meta() meta: RequestMeta) {
    await this.resets.request(input.email, meta);
    return { status: "SENT_IF_EXISTS" };
  }

  @Public()
  @Throttle(THROTTLE.authStrict)
  @Post("reset-password")
  @HttpCode(HttpStatus.NO_CONTENT)
  async resetPassword(@Body(new ZodValidationPipe(resetPasswordSchema)) input: ResetPasswordInput, @Meta() meta: RequestMeta): Promise<void> {
    await this.resets.reset(input, meta);
  }

  @AllowPendingMfa()
  @Get("me")
  me(@CurrentPrincipal() principal: AuthPrincipal): Promise<SessionUser> {
    return this.issuer.describe(principal);
  }

  private respond(issued: IssuedAuthentication, response: Response): AuthenticatedResult {
    setRefreshCookie(response, issued.refreshToken, this.config);
    return issued.result;
  }

  private async notifyTheft(userId: string): Promise<void> {
    const user = await this.users.findById(userId);
    if (user) {
      await this.email.send(AuthEmails.sessionTheft(user.email));
    }
  }
}
