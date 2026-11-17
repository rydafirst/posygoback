import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, ParseUUIDPipe, Post, Put, Req } from "@nestjs/common";
import type { RawBodyRequest } from "@nestjs/common";
import { Throttle } from "@nestjs/throttler";
import type { Request } from "express";
import { z } from "zod";

import type { AuthPrincipal, RequestMeta } from "../../../common/auth/auth-principal";
import { CurrentPrincipal, Meta, Public, RequirePermission } from "../../../common/auth/decorators";
import { Errors } from "../../../common/http/app-exception";
import { ZodValidationPipe } from "../../../common/http/zod-validation.pipe";
import { THROTTLE } from "../../../infrastructure/rate-limit/rate-limit.module";
import { type CreateStoreConnectionInput, createStoreConnectionSchema, type StoreSigningSecretInput, storeSigningSecretSchema } from "../../../shared";
import { StoreConnectionsService } from "./store-connections.service";
import { StoreWebhooksService } from "./store-webhooks.service";

const uuid = new ParseUUIDPipe({ version: "4" });
const storeToken = new ZodValidationPipe(z.string().regex(/^[A-Za-z0-9_-]{32}$/));

@Controller({ path: "vendor/integrations/stores", version: "1" })
export class VendorStoreConnectionsController {
  constructor(private readonly stores: StoreConnectionsService) {}

  @RequirePermission("vendor.integrations.manage")
  @Get()
  list(@CurrentPrincipal() principal: AuthPrincipal) {
    return this.stores.list(principal);
  }

  @RequirePermission("vendor.integrations.manage")
  @Throttle(THROTTLE.authStrict)
  @Post()
  create(@Body(new ZodValidationPipe(createStoreConnectionSchema)) input: CreateStoreConnectionInput, @CurrentPrincipal() principal: AuthPrincipal, @Meta() meta: RequestMeta) {
    return this.stores.create(principal, input, meta);
  }

  @RequirePermission("vendor.integrations.manage")
  @Throttle(THROTTLE.authStrict)
  @Put(":id/signing-secret")
  saveSecret(
    @Param("id", uuid) id: string,
    @Body(new ZodValidationPipe(storeSigningSecretSchema)) input: StoreSigningSecretInput,
    @CurrentPrincipal() principal: AuthPrincipal,
    @Meta() meta: RequestMeta,
  ) {
    return this.stores.saveSigningSecret(principal, id, input.secret, meta);
  }

  @RequirePermission("vendor.integrations.manage")
  @Delete(":id")
  disconnect(@Param("id", uuid) id: string, @CurrentPrincipal() principal: AuthPrincipal, @Meta() meta: RequestMeta) {
    return this.stores.disconnect(principal, id, meta);
  }
}

@Controller({ path: "integration/stores", version: "1" })
@Public()
export class StoreWebhooksController {
  constructor(private readonly webhooks: StoreWebhooksService) {}

  @Throttle({ default: { limit: 600, ttl: 60_000 } })
  @Post(":token")
  @HttpCode(HttpStatus.OK)
  async receive(@Param("token", storeToken) token: string, @Req() request: RawBodyRequest<Request>) {
    const body = Buffer.isBuffer(request.body) ? request.body : (request.rawBody ?? Buffer.alloc(0));
    const result = await this.webhooks.receive(token, body, request.headers);
    if (result === "unknown") {
      throw Errors.notFound("This shop link isn't connected to Posygo.");
    }
    if (result === "unsigned") {
      throw Errors.unauthenticated("Signature could not be verified.");
    }
    return { received: true };
  }
}
