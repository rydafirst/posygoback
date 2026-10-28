import { Body, Controller, Get, HttpCode, HttpStatus, Param, ParseUUIDPipe, Post, Put } from "@nestjs/common";
import { Throttle } from "@nestjs/throttler";
import { z } from "zod";

import type { AuthPrincipal, RequestMeta } from "../../../common/auth/auth-principal";
import { CurrentPrincipal, Meta, RequirePermission } from "../../../common/auth/decorators";
import { ZodValidationPipe } from "../../../common/http/zod-validation.pipe";
import { THROTTLE } from "../../../infrastructure/rate-limit/rate-limit.module";
import { type ActivationFeeInput, activationFeeSchema } from "../../../shared";
import { ActivationFeesService } from "./activation-fees.service";
import { ActivationPaymentsService } from "./activation-payments.service";

const uuid = new ParseUUIDPipe({ version: "4" });
const countryCodeParam = new ZodValidationPipe(z.string().regex(/^[A-Z]{2}$/));

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

@Controller({ path: "admin/countries", version: "1" })
export class AdminActivationFeesController {
  constructor(private readonly fees: ActivationFeesService) {}

  @RequirePermission("countries.read")
  @Put(":code/activation-fee")
  set(
    @Param("code", countryCodeParam) code: string,
    @Body(new ZodValidationPipe(activationFeeSchema)) input: ActivationFeeInput,
    @CurrentPrincipal() principal: AuthPrincipal,
    @Meta() meta: RequestMeta,
  ) {
    return this.fees.set(code, input, principal, meta);
  }
}
