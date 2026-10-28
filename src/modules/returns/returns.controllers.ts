import { Body, Controller, Get, HttpCode, HttpStatus, Param, ParseUUIDPipe, Post, Put, Query } from "@nestjs/common";
import { z } from "zod";

import type { AuthPrincipal, RequestMeta } from "../../common/auth/auth-principal";
import { CurrentPrincipal, Meta, RequirePermission } from "../../common/auth/decorators";
import { type SellerCountry, SelectedCountry } from "../../common/auth/selected-country";
import { ZodValidationPipe } from "../../common/http/zod-validation.pipe";
import {
  type CreateVendorReturnInput,
  createVendorReturnSchema,
  type InstructVendorReturnInput,
  instructVendorReturnSchema,
  type ReceiveVendorReturnInput,
  receiveVendorReturnSchema,
  VENDOR_RETURN_STATUSES,
  type VendorReturnStatus,
  type VendorReturnTrackingInput,
  vendorReturnTrackingSchema,
} from "../../shared";
import { VendorReturnsService } from "./vendor-returns.service";
import { WarehouseReturnsService } from "./warehouse-returns.service";

const uuid = new ParseUUIDPipe({ version: "4" });
const statusFilter = new ZodValidationPipe(z.enum(VENDOR_RETURN_STATUSES).optional());

@Controller({ path: "vendor/returns", version: "1" })
export class VendorReturnsController {
  constructor(private readonly returns: VendorReturnsService) {}

  @RequirePermission("vendor.orders.read")
  @Get()
  list(@SelectedCountry() country: SellerCountry, @Query("status", statusFilter) status?: VendorReturnStatus) {
    return this.returns.list(country, status);
  }

  @RequirePermission("vendor.orders.read")
  @Get("orders/:orderId")
  returnable(@CurrentPrincipal() principal: AuthPrincipal, @Param("orderId", uuid) orderId: string) {
    return this.returns.returnable(principal, orderId);
  }

  @RequirePermission("vendor.orders.read")
  @Get(":id")
  detail(@CurrentPrincipal() principal: AuthPrincipal, @Param("id", uuid) id: string) {
    return this.returns.detail(principal, id);
  }

  @RequirePermission("vendor.orders.read")
  @Post(":id/photos/:fileId/url")
  @HttpCode(HttpStatus.OK)
  photo(@CurrentPrincipal() principal: AuthPrincipal, @Param("id", uuid) id: string, @Param("fileId", uuid) fileId: string, @Meta() meta: RequestMeta) {
    return this.returns.photoUrl(principal, id, fileId, meta);
  }

  @RequirePermission("vendor.orders.manage")
  @Post()
  create(@CurrentPrincipal() principal: AuthPrincipal, @Body(new ZodValidationPipe(createVendorReturnSchema)) input: CreateVendorReturnInput, @Meta() meta: RequestMeta) {
    return this.returns.create(principal, input, meta);
  }

  @RequirePermission("vendor.orders.manage")
  @Put(":id/tracking")
  tracking(@CurrentPrincipal() principal: AuthPrincipal, @Param("id", uuid) id: string, @Body(new ZodValidationPipe(vendorReturnTrackingSchema)) input: VendorReturnTrackingInput) {
    return this.returns.addTracking(principal, id, input);
  }

  @RequirePermission("vendor.orders.manage")
  @Post(":id/cancel")
  @HttpCode(HttpStatus.OK)
  cancel(@CurrentPrincipal() principal: AuthPrincipal, @Param("id", uuid) id: string, @Meta() meta: RequestMeta) {
    return this.returns.cancel(principal, id, meta);
  }

  @RequirePermission("vendor.orders.manage")
  @Post(":id/instructions")
  @HttpCode(HttpStatus.OK)
  instruct(
    @CurrentPrincipal() principal: AuthPrincipal,
    @Param("id", uuid) id: string,
    @Body(new ZodValidationPipe(instructVendorReturnSchema)) input: InstructVendorReturnInput,
    @Meta() meta: RequestMeta,
  ) {
    return this.returns.instruct(principal, id, input, meta);
  }
}

@Controller({ path: "warehouse/returns", version: "1" })
export class WarehouseReturnsController {
  constructor(private readonly returns: WarehouseReturnsService) {}

  @RequirePermission("inbound.read")
  @Get()
  list(@CurrentPrincipal() principal: AuthPrincipal, @Query("status", statusFilter) status?: VendorReturnStatus) {
    return this.returns.list(principal, status);
  }

  @RequirePermission("inbound.read")
  @Get(":id")
  detail(@CurrentPrincipal() principal: AuthPrincipal, @Param("id", uuid) id: string) {
    return this.returns.detail(principal, id);
  }

  @RequirePermission("inbound.read")
  @Post(":id/photos/:fileId/url")
  @HttpCode(HttpStatus.OK)
  photo(@CurrentPrincipal() principal: AuthPrincipal, @Param("id", uuid) id: string, @Param("fileId", uuid) fileId: string, @Meta() meta: RequestMeta) {
    return this.returns.photoUrl(principal, id, fileId, meta);
  }

  @RequirePermission("inbound.receive")
  @Post(":id/receive")
  @HttpCode(HttpStatus.OK)
  receive(
    @CurrentPrincipal() principal: AuthPrincipal,
    @Param("id", uuid) id: string,
    @Body(new ZodValidationPipe(receiveVendorReturnSchema)) input: ReceiveVendorReturnInput,
    @Meta() meta: RequestMeta,
  ) {
    return this.returns.receive(principal, id, input, meta);
  }

  @RequirePermission("inbound.receive")
  @Post(":id/complete")
  @HttpCode(HttpStatus.OK)
  complete(@CurrentPrincipal() principal: AuthPrincipal, @Param("id", uuid) id: string, @Meta() meta: RequestMeta) {
    return this.returns.complete(principal, id, meta);
  }
}
