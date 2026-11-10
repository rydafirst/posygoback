import { Body, Controller, Get, HttpCode, HttpStatus, Param, ParseUUIDPipe, Post, Put } from "@nestjs/common";
import { Throttle } from "@nestjs/throttler";

import type { AuthPrincipal, RequestMeta } from "../../../common/auth/auth-principal";
import { CurrentPrincipal, Meta, RequirePermission } from "../../../common/auth/decorators";
import { ZodValidationPipe } from "../../../common/http/zod-validation.pipe";
import { THROTTLE } from "../../../infrastructure/rate-limit/rate-limit.module";
import { type ActivationFeeInput, activationFeeSchema } from "../../../shared";
import { ActivationFeesService } from "./activation-fees.service";
import { ActivationPaymentsService } from "./activation-payments.service";

const uuid = new ParseUUIDPipe({ version: "4" });

@Controller({ path: "vendor/activation", version: "1" })
export class VendorActivationController {
  constructor(private readonly payments: ActivationPaymentsService) {}

  @RequirePermission("vendor.portal.access")
  @Get()
  view(@CurrentPrincipal() principal: AuthPrincipal) {
    return this.payments.view(principal);
  }

  @RequirePermission("vendor.verification.manage")
  @Throttle(THROTTLE.authStrict)
  @Post("checkout")
  start(@CurrentPrincipal() principal: AuthPrincipal, @Meta() meta: RequestMeta) {
    return this.payments.start(principal, meta);
  }

  @RequirePermission("vendor.verification.manage")
  @Throttle(THROTTLE.authStrict)
  @Post("payments/:id/sandbox-pay")
  @HttpCode(HttpStatus.OK)
  sandboxPay(@Param("id", uuid) id: string, @CurrentPrincipal() principal: AuthPrincipal) {
    return this.payments.completeSandbox(principal, id);
  }
}

@Controller({ path: "admin/activation-fee", version: "1" })
export class AdminActivationFeesController {
  constructor(private readonly fees: ActivationFeesService) {}

  @RequirePermission("countries.read")
  @Get()
  current() {
    return this.fees.current();
  }

  @RequirePermission("countries.read")
  @Put()
  set(@Body(new ZodValidationPipe(activationFeeSchema)) input: ActivationFeeInput, @CurrentPrincipal() principal: AuthPrincipal, @Meta() meta: RequestMeta) {
    return this.fees.set(input, principal, meta);
  }
}

