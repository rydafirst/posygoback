import { Body, Controller, Get, HttpCode, HttpStatus, Param, ParseUUIDPipe, Post, Put, Query } from "@nestjs/common";
import { Throttle } from "@nestjs/throttler";
import {
  HOLD_CHARGE_LIMITS,
  INBOUND_STATUSES,
  type InboundEstimateInput,
  inboundEstimateSchema,
  type InboundInput,
  inboundInputSchema,
  type InboundMessageInput,
  inboundMessageSchema,
  type InboundStatus,
  type ReceiveInboundInput,
  receiveInboundSchema,
} from "../../../shared";
import { z } from "zod";

import type { AuthPrincipal, RequestMeta } from "../../../common/auth/auth-principal";
import { CurrentPrincipal, Meta, RequirePermission } from "../../../common/auth/decorators";
import { ZodValidationPipe } from "../../../common/http/zod-validation.pipe";
import { THROTTLE } from "../../../infrastructure/rate-limit/rate-limit.module";
import { VendorInboundService } from "./vendor-inbound.service";
import { type OperatorAction, WarehouseInboundService } from "./warehouse-inbound.service";

const uuid = new ParseUUIDPipe({ version: "4" });
const statusQuery = new ZodValidationPipe(z.enum(INBOUND_STATUSES).optional());
const operatorActionBody = new ZodValidationPipe(
  z.object({
    action: z.enum(["CHECK_IN", "HOLD", "RELEASE", "REJECT", "REQUEST_RETURN"]),
    reason: z.string().trim().min(10).max(1000).optional(),
    chargeMinor: z.number().int().min(HOLD_CHARGE_LIMITS.minMinor).max(HOLD_CHARGE_LIMITS.maxMinor).optional(),
  }),
);
const vendorActionBody = new ZodValidationPipe(z.object({ action: z.enum(["SUBMIT", "CANCEL", "PAY_HOLD"]) }));

@Controller({ path: "vendor/inbound", version: "1" })
export class VendorInboundController {
  constructor(private readonly inbound: VendorInboundService) {}

  @RequirePermission("vendor.stock.read")
  @Get()
  list(@CurrentPrincipal() principal: AuthPrincipal) {
    return this.inbound.list(principal);
  }

  @RequirePermission("vendor.stock.read")
  @Get(":id")
  detail(@Param("id", uuid) id: string, @CurrentPrincipal() principal: AuthPrincipal) {
    return this.inbound.detail(principal, id);
  }

  @RequirePermission("vendor.stock.read")
  @Post("estimate")
  @HttpCode(HttpStatus.OK)
  estimate(@Body(new ZodValidationPipe(inboundEstimateSchema)) input: InboundEstimateInput, @CurrentPrincipal() principal: AuthPrincipal) {
    return this.inbound.estimate(principal, input);
  }

  @RequirePermission("vendor.stock.manage")
  @Post()
  create(@Body(new ZodValidationPipe(inboundInputSchema)) input: InboundInput, @CurrentPrincipal() principal: AuthPrincipal, @Meta() meta: RequestMeta) {
    return this.inbound.create(principal, input, meta);
  }

  @RequirePermission("vendor.stock.manage")
  @Put(":id")
  update(@Param("id", uuid) id: string, @Body(new ZodValidationPipe(inboundInputSchema)) input: InboundInput, @CurrentPrincipal() principal: AuthPrincipal, @Meta() meta: RequestMeta) {
    return this.inbound.update(principal, id, input, meta);
  }

  @RequirePermission("vendor.stock.manage")
  @Post(":id/actions")
  @HttpCode(HttpStatus.OK)
  act(@Param("id", uuid) id: string, @Body(vendorActionBody) input: { action: "SUBMIT" | "CANCEL" | "PAY_HOLD" }, @CurrentPrincipal() principal: AuthPrincipal, @Meta() meta: RequestMeta) {
    return this.inbound.apply(principal, id, input.action, meta);
  }

  @RequirePermission("vendor.stock.manage")
  @Throttle(THROTTLE.auth)
  @Post(":id/messages")
  @HttpCode(HttpStatus.OK)
  message(@Param("id", uuid) id: string, @Body(new ZodValidationPipe(inboundMessageSchema)) input: InboundMessageInput, @CurrentPrincipal() principal: AuthPrincipal, @Meta() meta: RequestMeta) {
    return this.inbound.postMessage(principal, id, input.body, meta);
  }

  @RequirePermission("vendor.stock.read")
  @Post(":id/photos/:fileId/url")
  @HttpCode(HttpStatus.OK)
  photo(@Param("id", uuid) id: string, @Param("fileId", uuid) fileId: string, @CurrentPrincipal() principal: AuthPrincipal, @Meta() meta: RequestMeta) {
    return this.inbound.photoUrl(principal, id, fileId, meta);
  }
}

@Controller({ path: "warehouse/inbound", version: "1" })
export class WarehouseInboundController {
  constructor(private readonly inbound: WarehouseInboundService) {}

  @RequirePermission("inbound.read")
  @Get()
  queue(@CurrentPrincipal() principal: AuthPrincipal, @Query("status", statusQuery) status?: InboundStatus) {
    return this.inbound.queue(principal, status);
  }

  @RequirePermission("inbound.read")
  @Get(":id")
  detail(@Param("id", uuid) id: string, @CurrentPrincipal() principal: AuthPrincipal) {
    return this.inbound.detail(principal, id);
  }

  @RequirePermission("inbound.receive")
  @Post(":id/actions")
  @HttpCode(HttpStatus.OK)
  act(
    @Param("id", uuid) id: string,
    @Body(operatorActionBody)
    input: { action: OperatorAction; reason?: string; chargeMinor?: number },
    @CurrentPrincipal() principal: AuthPrincipal,
    @Meta() meta: RequestMeta,
  ) {
    return this.inbound.apply(principal, id, input.action, input.reason, input.chargeMinor, meta);
  }

  @RequirePermission("inbound.receive")
  @Post(":id/receive")
  @HttpCode(HttpStatus.OK)
  receive(@Param("id", uuid) id: string, @Body(new ZodValidationPipe(receiveInboundSchema)) input: ReceiveInboundInput, @CurrentPrincipal() principal: AuthPrincipal, @Meta() meta: RequestMeta) {
    return this.inbound.receive(principal, id, input, meta);
  }

  @RequirePermission("inbound.receive")
  @Throttle(THROTTLE.auth)
  @Post(":id/messages")
  @HttpCode(HttpStatus.OK)
  message(@Param("id", uuid) id: string, @Body(new ZodValidationPipe(inboundMessageSchema)) input: InboundMessageInput, @CurrentPrincipal() principal: AuthPrincipal, @Meta() meta: RequestMeta) {
    return this.inbound.postMessage(principal, id, input.body, meta);
  }

  @RequirePermission("inbound.read")
  @Post(":id/photos/:fileId/url")
  @HttpCode(HttpStatus.OK)
  photo(@Param("id", uuid) id: string, @Param("fileId", uuid) fileId: string, @CurrentPrincipal() principal: AuthPrincipal, @Meta() meta: RequestMeta) {
    return this.inbound.photoUrl(principal, id, fileId, meta);
  }
}
