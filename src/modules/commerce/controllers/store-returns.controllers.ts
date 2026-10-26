import { Body, Controller, Get, HttpCode, HttpStatus, Param, ParseUUIDPipe, Post, Put, Query } from "@nestjs/common";
import { z } from "zod";

import type { AuthPrincipal, RequestMeta } from "../../../common/auth/auth-principal";
import { CurrentPrincipal, Meta, RequirePermission } from "../../../common/auth/decorators";
import { ZodValidationPipe } from "../../../common/http/zod-validation.pipe";
import {
  type DiscountCodeInput,
  discountCodeSchema,
  type DiscountUpdateInput,
  discountUpdateSchema,
  type ReturnDecisionInput,
  returnDecisionSchema,
  STOREFRONT_RETURN_STATUSES,
  type StorefrontReturnStatus,
} from "../../../shared";
import { StorefrontReturnsService } from "../returns/storefront-returns.service";
import { DiscountCodesService } from "../storefront/discount-codes.service";

const uuid = new ParseUUIDPipe({ version: "4" });
const statusFilter = new ZodValidationPipe(z.enum(STOREFRONT_RETURN_STATUSES).optional());

@Controller({ path: "vendor/storefront", version: "1" })
export class VendorStoreReturnsController {
  constructor(
    private readonly returns: StorefrontReturnsService,
    private readonly discounts: DiscountCodesService,
  ) {}

  @RequirePermission("vendor.stock.read")
  @Get("returns")
  listReturns(@CurrentPrincipal() principal: AuthPrincipal, @Query("status", statusFilter) status?: StorefrontReturnStatus) {
    return this.returns.listForVendor(principal, status);
  }

  @RequirePermission("vendor.storefront.manage")
  @Post("returns/:id/decision")
  @HttpCode(HttpStatus.OK)
  decide(@CurrentPrincipal() principal: AuthPrincipal, @Param("id", uuid) id: string, @Body(new ZodValidationPipe(returnDecisionSchema)) input: ReturnDecisionInput, @Meta() meta: RequestMeta) {
    return this.returns.decide(principal, id, input, meta);
  }

  @RequirePermission("vendor.storefront.manage")
  @Post("returns/:id/refund-retry")
  @HttpCode(HttpStatus.OK)
  retry(@CurrentPrincipal() principal: AuthPrincipal, @Param("id", uuid) id: string) {
    return this.returns.retryRefund(principal, id);
  }

  @RequirePermission("vendor.stock.read")
  @Get("discounts")
  listDiscounts(@CurrentPrincipal() principal: AuthPrincipal) {
    return this.discounts.list(principal);
  }

  @RequirePermission("vendor.storefront.manage")
  @Post("discounts")
  createDiscount(@CurrentPrincipal() principal: AuthPrincipal, @Body(new ZodValidationPipe(discountCodeSchema)) input: DiscountCodeInput, @Meta() meta: RequestMeta) {
    return this.discounts.create(principal, input, meta);
  }

  @RequirePermission("vendor.storefront.manage")
  @Put("discounts/:id")
  updateDiscount(
    @CurrentPrincipal() principal: AuthPrincipal,
    @Param("id", uuid) id: string,
    @Body(new ZodValidationPipe(discountUpdateSchema)) input: DiscountUpdateInput,
    @Meta() meta: RequestMeta,
  ) {
    return this.discounts.setActive(principal, id, input.active, meta);
  }
}

@Controller({ path: "admin/storefront-returns", version: "1" })
export class AdminStoreReturnsController {
  constructor(private readonly returns: StorefrontReturnsService) {}

  @RequirePermission("storefronts.read")
  @Get()
  list(@CurrentPrincipal() principal: AuthPrincipal, @Query("status", statusFilter) status?: StorefrontReturnStatus) {
    return this.returns.listForStaff(principal, status);
  }

  @RequirePermission("storefronts.manage")
  @Post(":id/decision")
  @HttpCode(HttpStatus.OK)
  decide(@CurrentPrincipal() principal: AuthPrincipal, @Param("id", uuid) id: string, @Body(new ZodValidationPipe(returnDecisionSchema)) input: ReturnDecisionInput, @Meta() meta: RequestMeta) {
    return this.returns.decide(principal, id, input, meta);
  }

  @RequirePermission("storefronts.manage")
  @Post(":id/refund-retry")
  @HttpCode(HttpStatus.OK)
  retry(@CurrentPrincipal() principal: AuthPrincipal, @Param("id", uuid) id: string) {
    return this.returns.retryRefund(principal, id);
  }
}
