import { Body, Controller, Get, HttpCode, HttpStatus, Param, ParseUUIDPipe, Post, Put } from "@nestjs/common";

import type { AuthPrincipal, RequestMeta } from "../../common/auth/auth-principal";
import { CurrentPrincipal, Meta, RequirePermission } from "../../common/auth/decorators";
import { ZodValidationPipe } from "../../common/http/zod-validation.pipe";
import { campaignActiveSchema, type ReferralCampaignInput, referralCampaignSchema, type VoidReferralInput, voidReferralSchema } from "../../shared";
import { ReferralAdminService } from "./referral-admin.service";
import { ReferralsService } from "./referrals.service";

const uuid = new ParseUUIDPipe({ version: "4" });

@Controller({ path: "vendor/referrals", version: "1" })
export class VendorReferralsController {
  constructor(private readonly referrals: ReferralsService) {}

  @RequirePermission("vendor.portal.access")
  @Get()
  mine(@CurrentPrincipal() principal: AuthPrincipal) {
    return this.referrals.mine(principal);
  }
}

@Controller({ path: "admin/referrals", version: "1" })
export class AdminReferralsController {
  constructor(private readonly admin: ReferralAdminService) {}

  @RequirePermission("referrals.read")
  @Get()
  list(@CurrentPrincipal() principal: AuthPrincipal) {
    return this.admin.referrals(principal);
  }

  @RequirePermission("referrals.manage")
  @Post(":id/void")
  @HttpCode(HttpStatus.OK)
  voidReferral(@CurrentPrincipal() principal: AuthPrincipal, @Param("id", uuid) id: string, @Body(new ZodValidationPipe(voidReferralSchema)) input: VoidReferralInput, @Meta() meta: RequestMeta) {
    return this.admin.voidReferral(principal, id, input.reason, meta);
  }

  @RequirePermission("referrals.read")
  @Get("campaigns")
  campaigns(@CurrentPrincipal() principal: AuthPrincipal) {
    return this.admin.campaigns(principal);
  }

  @RequirePermission("referrals.manage")
  @Post("campaigns")
  createCampaign(@CurrentPrincipal() principal: AuthPrincipal, @Body(new ZodValidationPipe(referralCampaignSchema)) input: ReferralCampaignInput, @Meta() meta: RequestMeta) {
    return this.admin.createCampaign(principal, input, meta);
  }

  @RequirePermission("referrals.manage")
  @Put("campaigns/:id")
  setActive(@CurrentPrincipal() principal: AuthPrincipal, @Param("id", uuid) id: string, @Body(new ZodValidationPipe(campaignActiveSchema)) input: { active: boolean }, @Meta() meta: RequestMeta) {
    return this.admin.setActive(principal, id, input.active, meta);
  }
}
