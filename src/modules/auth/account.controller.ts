import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Post } from "@nestjs/common";
import { Throttle } from "@nestjs/throttler";

import type { AuthPrincipal, RequestMeta } from "../../common/auth/auth-principal";
import { CurrentPrincipal, Meta, Public } from "../../common/auth/decorators";
import { ZodValidationPipe } from "../../common/http/zod-validation.pipe";
import { THROTTLE } from "../../infrastructure/rate-limit/rate-limit.module";
import { type AccountView, type ChangeEmailInput, changeEmailSchema, type ChangePasswordInput, changePasswordSchema, type ConfirmEmailChangeInput, confirmEmailChangeSchema } from "../../shared";
import { AccountChangesService } from "./flows/account-changes.service";

@Controller({ path: "account", version: "1" })
export class AccountController {
  constructor(private readonly changes: AccountChangesService) {}

  @Get()
  view(@CurrentPrincipal() principal: AuthPrincipal): Promise<AccountView> {
    return this.changes.view(principal);
  }

  @Throttle(THROTTLE.authStrict)
  @Post("password")
  @HttpCode(HttpStatus.NO_CONTENT)
  async changePassword(@Body(new ZodValidationPipe(changePasswordSchema)) input: ChangePasswordInput, @CurrentPrincipal() principal: AuthPrincipal, @Meta() meta: RequestMeta): Promise<void> {
    await this.changes.changePassword(principal, input, meta);
  }

  @Throttle(THROTTLE.authStrict)
  @Post("email")
  @HttpCode(HttpStatus.ACCEPTED)
  changeEmail(@Body(new ZodValidationPipe(changeEmailSchema)) input: ChangeEmailInput, @CurrentPrincipal() principal: AuthPrincipal, @Meta() meta: RequestMeta): Promise<AccountView> {
    return this.changes.requestEmailChange(principal, input, meta);
  }

  @Delete("email")
  cancelEmailChange(@CurrentPrincipal() principal: AuthPrincipal, @Meta() meta: RequestMeta): Promise<AccountView> {
    return this.changes.cancelEmailChange(principal, meta);
  }

  @Public()
  @Throttle(THROTTLE.authStrict)
  @Post("email/confirm")
  @HttpCode(HttpStatus.NO_CONTENT)
  async confirmEmailChange(@Body(new ZodValidationPipe(confirmEmailChangeSchema)) input: ConfirmEmailChangeInput, @Meta() meta: RequestMeta): Promise<void> {
    await this.changes.confirmEmailChange(input.token, meta);
  }
}
