import { Body, Controller, HttpCode, HttpStatus, Post } from "@nestjs/common";
import { Throttle } from "@nestjs/throttler";
import { type AuthenticatedResult, type MfaConfirmInput, mfaConfirmSchema, type MfaEnrolmentComplete, type MfaEnrolmentStart } from "../../shared";

import type { AuthPrincipal, RequestMeta } from "../../common/auth/auth-principal";
import { AllowPendingMfa, CurrentPrincipal, Meta } from "../../common/auth/decorators";
import { ZodValidationPipe } from "../../common/http/zod-validation.pipe";
import { THROTTLE } from "../../infrastructure/rate-limit/rate-limit.module";
import { MfaEnrolmentService } from "./flows/mfa-enrolment.service";
import { TestShortcutsService } from "./flows/test-shortcuts.service";

@Controller({ path: "auth/mfa", version: "1" })
export class MfaController {
  constructor(
    private readonly enrolment: MfaEnrolmentService,
    private readonly shortcuts: TestShortcutsService,
  ) {}

  @AllowPendingMfa()
  @Throttle(THROTTLE.auth)
  @Post("enrolment")
  @HttpCode(HttpStatus.OK)
  start(@CurrentPrincipal() principal: AuthPrincipal): Promise<MfaEnrolmentStart> {
    return this.enrolment.start(principal);
  }

  @AllowPendingMfa()
  @Throttle(THROTTLE.auth)
  @Post("enrolment/confirm")
  @HttpCode(HttpStatus.OK)
  confirm(@CurrentPrincipal() principal: AuthPrincipal, @Body(new ZodValidationPipe(mfaConfirmSchema)) input: MfaConfirmInput, @Meta() meta: RequestMeta): Promise<MfaEnrolmentComplete> {
    return this.enrolment.confirm(principal, input, meta);
  }

  @AllowPendingMfa()
  @Throttle(THROTTLE.auth)
  @Post("skip")
  @HttpCode(HttpStatus.OK)
  skip(@CurrentPrincipal() principal: AuthPrincipal, @Meta() meta: RequestMeta): Promise<AuthenticatedResult> {
    return this.shortcuts.skipMfaEnrolment(principal, meta);
  }
}
