import { Body, Controller, Get, HttpCode, HttpStatus, Param, ParseUUIDPipe, Post, Put, Query } from "@nestjs/common";
import { Throttle } from "@nestjs/throttler";
import { DOCUMENT_SLOTS, type DocumentSlot, type VerificationDecisionInput, verificationDecisionSchema, VERIFICATION_STATUSES, type VerificationStatus } from "../../../shared";
import { z } from "zod";

import type { AuthPrincipal, RequestMeta } from "../../../common/auth/auth-principal";
import { CurrentPrincipal, Meta, RequirePermission } from "../../../common/auth/decorators";
import { ZodValidationPipe } from "../../../common/http/zod-validation.pipe";
import { THROTTLE } from "../../../infrastructure/rate-limit/rate-limit.module";
import { VendorIdentityService } from "./vendor-identity.service";
import { VendorVerificationService } from "./vendor-verification.service";
import { VerificationReviewService } from "./verification-review.service";

const uuid = new ParseUUIDPipe({ version: "4" });
const optionalStatus = new ZodValidationPipe(z.enum(VERIFICATION_STATUSES).optional());
const slotParam = new ZodValidationPipe(z.enum(DOCUMENT_SLOTS));

@Controller({ path: "vendor/verification", version: "1" })
export class VendorVerificationController {
  constructor(
    private readonly verification: VendorVerificationService,
    private readonly identity: VendorIdentityService,
  ) {}

  @RequirePermission("vendor.portal.access")
  @Get()
  view(@CurrentPrincipal() principal: AuthPrincipal) {
    return this.verification.view(principal);
  }

  @RequirePermission("vendor.verification.manage")
  @Put()
  save(@CurrentPrincipal() principal: AuthPrincipal, @Body() input: unknown, @Meta() meta: RequestMeta) {
    return this.verification.saveDraft(principal, input, meta);
  }

  @RequirePermission("vendor.verification.manage")
  @Throttle(THROTTLE.authStrict)
  @Post("submit")
  @HttpCode(HttpStatus.OK)
  submit(@CurrentPrincipal() principal: AuthPrincipal, @Meta() meta: RequestMeta) {
    return this.verification.submit(principal, meta);
  }

  @RequirePermission("vendor.verification.manage")
  @Throttle(THROTTLE.authStrict)
  @Post("identity/session")
  @HttpCode(HttpStatus.OK)
  startIdentity(@CurrentPrincipal() principal: AuthPrincipal, @Meta() meta: RequestMeta) {
    return this.identity.start(principal, meta);
  }

  @RequirePermission("vendor.verification.manage")
  @Post("identity/refresh")
  @HttpCode(HttpStatus.OK)
  async refreshIdentity(@CurrentPrincipal() principal: AuthPrincipal) {
    await this.identity.refresh(principal);
    return this.verification.view(principal);
  }
}

@Controller({ path: "admin/verifications", version: "1" })
export class AdminVerificationsController {
  constructor(private readonly review: VerificationReviewService) {}

  @RequirePermission("verifications.read")
  @Get()
  queue(@CurrentPrincipal() principal: AuthPrincipal, @Query("status", optionalStatus) status?: VerificationStatus) {
    return this.review.queue(principal, status);
  }

  @RequirePermission("verifications.read")
  @Get(":vendorId")
  detail(@Param("vendorId", uuid) vendorId: string, @CurrentPrincipal() principal: AuthPrincipal, @Meta() meta: RequestMeta) {
    return this.review.detail(principal, vendorId, meta);
  }

  @RequirePermission("verifications.review")
  @Post(":vendorId/documents/:slot/url")
  @HttpCode(HttpStatus.OK)
  document(@Param("vendorId", uuid) vendorId: string, @Param("slot", slotParam) slot: DocumentSlot, @CurrentPrincipal() principal: AuthPrincipal, @Meta() meta: RequestMeta) {
    return this.review.documentUrl(principal, vendorId, slot, meta);
  }

  @RequirePermission("verifications.review")
  @Throttle(THROTTLE.auth)
  @Post(":vendorId/id-number")
  @HttpCode(HttpStatus.OK)
  revealIdNumber(@Param("vendorId", uuid) vendorId: string, @CurrentPrincipal() principal: AuthPrincipal, @Meta() meta: RequestMeta) {
    return this.review.revealIdNumber(principal, vendorId, meta);
  }

  @RequirePermission("verifications.review")
  @Post(":vendorId/decision")
  @HttpCode(HttpStatus.OK)
  decide(
    @Param("vendorId", uuid) vendorId: string,
    @Body(new ZodValidationPipe(verificationDecisionSchema)) input: VerificationDecisionInput,
    @CurrentPrincipal() principal: AuthPrincipal,
    @Meta() meta: RequestMeta,
  ) {
    return this.review.decide(principal, vendorId, input, meta);
  }
}
