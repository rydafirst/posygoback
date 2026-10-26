import { Global, Module } from "@nestjs/common";
import { JwtModule } from "@nestjs/jwt";

import { APP_CONFIG } from "../../config/config.module";
import type { AppConfig } from "../../config/config.schema";
import { CountriesModule } from "../countries/countries.module";
import { AuthController } from "./auth.controller";
import { VerificationCodeService } from "./codes/verification-code.service";
import { EmailVerificationService } from "./flows/email-verification.service";
import { LoginService } from "./flows/login.service";
import { MfaEnrolmentService } from "./flows/mfa-enrolment.service";
import { PasswordResetService } from "./flows/password-reset.service";
import { SignupService } from "./flows/signup.service";
import { MfaController } from "./mfa.controller";
import { MfaChallengeService } from "./mfa/mfa-challenge.service";
import { RecoveryCodeService } from "./mfa/recovery-code.service";
import { TotpService } from "./mfa/totp.service";
import { BREACHED_PASSWORD_CHECKER, DisabledBreachChecker, PwnedPasswordsChecker } from "./password/breached-password.checker";
import { PasswordService } from "./password/password.service";
import { SessionIssuerService } from "./sessions/session-issuer.service";
import { TestShortcutsService } from "./flows/test-shortcuts.service";
import { SessionService } from "./sessions/session.service";
import { AccessTokenService } from "./tokens/access-token.service";
import { UsersRepository } from "./users.repository";

@Global()
@Module({
  imports: [JwtModule.register({}), CountriesModule],
  controllers: [AuthController, MfaController],
  providers: [
    {
      provide: BREACHED_PASSWORD_CHECKER,
      inject: [APP_CONFIG],
      useFactory: (config: AppConfig) => (config.PASSWORD_BREACH_CHECK === "hibp" ? new PwnedPasswordsChecker() : new DisabledBreachChecker()),
    },
    UsersRepository,
    PasswordService,
    AccessTokenService,
    SessionService,
    SessionIssuerService,
    TestShortcutsService,
    VerificationCodeService,
    TotpService,
    RecoveryCodeService,
    MfaChallengeService,
    SignupService,
    EmailVerificationService,
    LoginService,
    MfaEnrolmentService,
    PasswordResetService,
  ],
  exports: [AccessTokenService, SessionService, SessionIssuerService, UsersRepository, PasswordService],
})
export class AuthModule {}
