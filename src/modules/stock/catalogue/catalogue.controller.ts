import { Body, Controller, Get, HttpCode, HttpStatus, Param, ParseUUIDPipe, Post, Put, Query } from "@nestjs/common";
import { PRODUCT_STATUSES, type ProductInput, productInputSchema, type ProductStatus } from "../../../shared";
import { z } from "zod";

import type { AuthPrincipal, RequestMeta } from "../../../common/auth/auth-principal";
import { CurrentPrincipal, Meta, RequirePermission } from "../../../common/auth/decorators";
import { ZodValidationPipe } from "../../../common/http/zod-validation.pipe";
import { CatalogueService } from "./catalogue.service";

const uuid = new ParseUUIDPipe({ version: "4" });
const statusQuery = new ZodValidationPipe(z.enum(PRODUCT_STATUSES).optional());
const statusBody = new ZodValidationPipe(z.object({ status: z.enum(PRODUCT_STATUSES) }));

@Controller({ path: "vendor/products", version: "1" })
export class CatalogueController {
  constructor(private readonly catalogue: CatalogueService) {}

  @RequirePermission("vendor.stock.read")
  @Get()
  list(@CurrentPrincipal() principal: AuthPrincipal, @Query("status", statusQuery) status?: ProductStatus) {
    return this.catalogue.list(principal, status);
  }

  @RequirePermission("vendor.stock.read")
  @Get(":id")
  get(@Param("id", uuid) id: string, @CurrentPrincipal() principal: AuthPrincipal) {
    return this.catalogue.get(principal, id);
  }

  @RequirePermission("vendor.stock.read")
  @Post(":id/image-url")
  @HttpCode(HttpStatus.OK)
  image(@Param("id", uuid) id: string, @CurrentPrincipal() principal: AuthPrincipal, @Meta() meta: RequestMeta) {
    return this.catalogue.imageUrl(principal, id, meta);
  }

  @RequirePermission("vendor.stock.manage")
  @Post()
  create(@Body(new ZodValidationPipe(productInputSchema)) input: ProductInput, @CurrentPrincipal() principal: AuthPrincipal, @Meta() meta: RequestMeta) {
    return this.catalogue.create(principal, input, meta);
  }

  @RequirePermission("vendor.stock.manage")
  @Put(":id")
  update(@Param("id", uuid) id: string, @Body(new ZodValidationPipe(productInputSchema)) input: ProductInput, @CurrentPrincipal() principal: AuthPrincipal, @Meta() meta: RequestMeta) {
    return this.catalogue.update(principal, id, input, meta);
  }

  @RequirePermission("vendor.stock.manage")
  @Post(":id/status")
  @HttpCode(HttpStatus.OK)
  setStatus(@Param("id", uuid) id: string, @Body(statusBody) input: { status: ProductStatus }, @CurrentPrincipal() principal: AuthPrincipal, @Meta() meta: RequestMeta) {
    return this.catalogue.setStatus(principal, id, input.status, meta);
  }
}
