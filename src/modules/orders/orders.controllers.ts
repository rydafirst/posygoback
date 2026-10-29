import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, ParseUUIDPipe, Post, Put, Query, Req, Res, UseGuards } from "@nestjs/common";
import { Throttle } from "@nestjs/throttler";
import type { RawBodyRequest } from "@nestjs/common";
import type { Request, Response } from "express";
import { z } from "zod";

import type { AuthPrincipal, RequestMeta } from "../../common/auth/auth-principal";
import { CurrentPrincipal, Meta, Public, RequirePermission } from "../../common/auth/decorators";
import { type SellerCountry, SelectedCountry } from "../../common/auth/selected-country";
import { Errors } from "../../common/http/app-exception";
import { ZodValidationPipe } from "../../common/http/zod-validation.pipe";
import { APP_CONFIG } from "../../config/config.module";
import { THROTTLE } from "../../infrastructure/rate-limit/rate-limit.module";
import {
  type CancellationDecisionInput,
  cancellationDecisionSchema,
  dispatchPhotosSchema,
  type CreateOrdersInput,
  shippingEstimateSchema,
  type ShippingEstimateInput,
  createApiKeySchema,
  createOrdersSchema,
  type IntegrationOrderInput,
  integrationOrderSchema,
  isoCountryCode,
  ORDER_STATUSES,
  type PackagingPresetInput,
  packagingPresetSchema,
  type PackInput,
  packSchema,
  scanSchema,
  type StaffOrderActionInput,
  staffOrderActionSchema,
  type VendorOrderActionInput,
  vendorOrderActionSchema,
} from "../../shared";
import { Inject } from "@nestjs/common";
import type { AppConfig } from "../../config/config.schema";
import { OrderTrackingService } from "./core/order-tracking.service";
import { ShippingEstimateService } from "./core/shipping-estimate.service";
import { ApiKeyGuard, CurrentApiClient } from "./integration/api-key.guard";
import { type ApiClient, ApiKeysService } from "./integration/api-keys.service";
import { IntegrationOrdersService } from "./integration/integration-orders.service";
import { PackagingService } from "./packaging/packaging.service";
import { OrderImportService } from "./vendor/order-import.service";
import { VendorOrdersService } from "./vendor/vendor-orders.service";
import { FulfilmentService } from "./warehouse/fulfilment.service";

const uuid = new ParseUUIDPipe({ version: "4" });
const listQuery = new ZodValidationPipe(z.object({ status: z.enum(ORDER_STATUSES).optional(), q: z.string().trim().max(64).optional(), warehouseId: z.string().uuid().optional() }));
const countryParam = new ZodValidationPipe(isoCountryCode);
const estimateBody = new ZodValidationPipe(z.object({ units: z.number().int().min(1).max(50_000) }));
const importBody = new ZodValidationPipe(z.object({ filename: z.string().trim().min(1).max(200), csv: z.string().min(1).max(300_000) }));
const trackingParam = new ZodValidationPipe(z.string().regex(/^[A-Za-z0-9-]{6,64}$/));
const referenceParam = new ZodValidationPipe(z.string().regex(/^[A-Za-z0-9._:#/-]{1,64}$/));
const webhookToken = new ZodValidationPipe(z.string().regex(/^[A-Za-z0-9_-]{32,128}$/));
const simulateBody = new ZodValidationPipe(
  z.object({ status: z.enum(["IN_TRANSIT", "DELIVERED", "RETURNED", "FAILURE"]), description: z.string().trim().min(3).max(200), location: z.string().trim().max(120).optional() }),
);

@Controller({ path: "vendor/orders", version: "1" })
export class VendorOrdersController {
  constructor(
    private readonly orders: VendorOrdersService,
    private readonly imports: OrderImportService,
    private readonly shippingEstimates: ShippingEstimateService,
  ) {}

  @RequirePermission("vendor.orders.read")
  @Get()
  list(@Query(listQuery) query: { status?: (typeof ORDER_STATUSES)[number]; q?: string }, @SelectedCountry() country: SellerCountry) {
    return this.orders.list(country, query);
  }

  @RequirePermission("vendor.orders.manage")
  @Post()
  create(@Body(new ZodValidationPipe(createOrdersSchema)) input: CreateOrdersInput, @SelectedCountry() country: SellerCountry, @CurrentPrincipal() principal: AuthPrincipal) {
    return this.orders.create(principal, country, input);
  }

  @RequirePermission("vendor.orders.manage")
  @Post("shipping-estimate")
  @HttpCode(HttpStatus.OK)
  shippingEstimate(@Body(new ZodValidationPipe(shippingEstimateSchema)) input: ShippingEstimateInput, @SelectedCountry() country: SellerCountry, @CurrentPrincipal() principal: AuthPrincipal) {
    return this.shippingEstimates.estimate(principal, country, input);
  }

  @RequirePermission("vendor.orders.read")
  @Post("estimate")
  @HttpCode(HttpStatus.OK)
  estimate(@Body(estimateBody) input: { units: number }, @SelectedCountry() country: SellerCountry) {
    return this.orders.estimate(country, input.units);
  }

  @RequirePermission("vendor.orders.read")
  @Get("imports")
  importHistory(@SelectedCountry() country: SellerCountry) {
    return this.imports.history(country);
  }

  @RequirePermission("vendor.orders.manage")
  @Throttle(THROTTLE.authStrict)
  @Post("imports")
  importCsv(@Body(importBody) input: { filename: string; csv: string }, @SelectedCountry() country: SellerCountry, @CurrentPrincipal() principal: AuthPrincipal, @Meta() meta: RequestMeta) {
    return this.imports.run(principal, country, input.filename, input.csv, meta);
  }

  @RequirePermission("vendor.orders.read")
  @Get(":id")
  detail(@Param("id", uuid) id: string, @CurrentPrincipal() principal: AuthPrincipal) {
    return this.orders.detail(principal, id);
  }

  @RequirePermission("vendor.orders.manage")
  @Post(":id/actions")
  @HttpCode(HttpStatus.OK)
  act(@Param("id", uuid) id: string, @Body(new ZodValidationPipe(vendorOrderActionSchema)) input: VendorOrderActionInput, @CurrentPrincipal() principal: AuthPrincipal, @Meta() meta: RequestMeta) {
    return this.orders.act(principal, id, input, meta);
  }
}

@Controller({ path: "vendor/integrations/keys", version: "1" })
export class VendorApiKeysController {
  constructor(private readonly keys: ApiKeysService) {}

  @RequirePermission("vendor.integrations.manage")
  @Get()
  list(@CurrentPrincipal() principal: AuthPrincipal) {
    return this.keys.list(principal);
  }

  @RequirePermission("vendor.integrations.manage")
  @Throttle(THROTTLE.authStrict)
  @Post()
  create(@Body(new ZodValidationPipe(createApiKeySchema)) input: { name: string }, @CurrentPrincipal() principal: AuthPrincipal, @Meta() meta: RequestMeta) {
    return this.keys.create(principal, input.name, meta);
  }

  @RequirePermission("vendor.integrations.manage")
  @Delete(":id")
  revoke(@Param("id", uuid) id: string, @CurrentPrincipal() principal: AuthPrincipal, @Meta() meta: RequestMeta) {
    return this.keys.revoke(principal, id, meta);
  }
}

@Controller({ path: "warehouse/orders", version: "1" })
export class WarehouseOrdersController {
  constructor(
    private readonly fulfilment: FulfilmentService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  @RequirePermission("orders.read")
  @Get()
  queue(
    @Query(listQuery)
    query: { status?: (typeof ORDER_STATUSES)[number]; q?: string; warehouseId?: string },
    @CurrentPrincipal() principal: AuthPrincipal,
  ) {
    return this.fulfilment.queue(principal, query);
  }

  @RequirePermission("orders.read")
  @Get("cancellation-requests")
  cancellationRequests(@CurrentPrincipal() principal: AuthPrincipal) {
    return this.fulfilment.cancellationQueue(principal);
  }

  @RequirePermission("orders.read")
  @Get(":id")
  detail(@Param("id", uuid) id: string, @CurrentPrincipal() principal: AuthPrincipal) {
    return this.fulfilment.detail(principal, id);
  }

  @RequirePermission("orders.fulfil")
  @Throttle({ default: { limit: 600, ttl: 60_000 } })
  @Post(":id/scans")
  @HttpCode(HttpStatus.OK)
  scan(@Param("id", uuid) id: string, @Body(new ZodValidationPipe(scanSchema)) input: { code: string }, @CurrentPrincipal() principal: AuthPrincipal) {
    return this.fulfilment.scan(principal, id, input.code);
  }

  @RequirePermission("orders.fulfil")
  @Delete(":id/scans")
  resetScans(@Param("id", uuid) id: string, @CurrentPrincipal() principal: AuthPrincipal) {
    return this.fulfilment.resetScans(principal, id);
  }

  @RequirePermission("orders.fulfil")
  @Post(":id/pack")
  @HttpCode(HttpStatus.OK)
  pack(@Param("id", uuid) id: string, @Body(new ZodValidationPipe(packSchema)) input: PackInput, @CurrentPrincipal() principal: AuthPrincipal, @Meta() meta: RequestMeta) {
    return this.fulfilment.recordPack(principal, id, input, meta);
  }

  @RequirePermission("orders.read")
  @Post(":id/actions")
  @HttpCode(HttpStatus.OK)
  act(@Param("id", uuid) id: string, @Body(new ZodValidationPipe(staffOrderActionSchema)) input: StaffOrderActionInput, @CurrentPrincipal() principal: AuthPrincipal, @Meta() meta: RequestMeta) {
    return this.fulfilment.act(principal, id, input, meta);
  }

  @RequirePermission("orders.fulfil")
  @Post(":id/dispatch-photos")
  @HttpCode(HttpStatus.OK)
  dispatchPhotos(
    @Param("id", uuid) id: string,
    @Body(new ZodValidationPipe(dispatchPhotosSchema)) input: { fileIds: string[] },
    @CurrentPrincipal() principal: AuthPrincipal,
    @Meta() meta: RequestMeta,
  ) {
    return this.fulfilment.addDispatchPhotos(principal, id, input.fileIds, meta);
  }

  @RequirePermission("orders.cancel")
  @Post(":id/cancellation-decision")
  @HttpCode(HttpStatus.OK)
  decide(
    @Param("id", uuid) id: string,
    @Body(new ZodValidationPipe(cancellationDecisionSchema)) input: CancellationDecisionInput,
    @CurrentPrincipal() principal: AuthPrincipal,
    @Meta() meta: RequestMeta,
  ) {
    return this.fulfilment.decideCancellation(principal, id, input.approve, input.note, meta);
  }

  @RequirePermission("orders.fulfil")
  @Post(":id/sandbox-tracking")
  @HttpCode(HttpStatus.OK)
  simulate(
    @Param("id", uuid) id: string,
    @Body(simulateBody)
    input: { status: "IN_TRANSIT" | "DELIVERED" | "RETURNED" | "FAILURE"; description: string; location?: string },
    @CurrentPrincipal() principal: AuthPrincipal,
  ) {
    if (this.config.NODE_ENV === "production") {
      throw Errors.notFound();
    }
    return this.fulfilment.simulateTracking(principal, id, { status: input.status, description: input.description, location: input.location ?? null, occurredAt: new Date().toISOString() });
  }
}

@Controller({ version: "1" })
export class PackagingController {
  constructor(private readonly packaging: PackagingService) {}

  @RequirePermission("orders.read")
  @Get("warehouse/packaging/:countryCode")
  list(@Param("countryCode", countryParam) countryCode: string, @CurrentPrincipal() principal: AuthPrincipal) {
    return this.packaging.list(principal, countryCode);
  }

  @RequirePermission("packaging.manage")
  @Post("admin/packaging/:countryCode")
  create(
    @Param("countryCode", countryParam) countryCode: string,
    @Body(new ZodValidationPipe(packagingPresetSchema)) input: PackagingPresetInput,
    @CurrentPrincipal() principal: AuthPrincipal,
    @Meta() meta: RequestMeta,
  ) {
    return this.packaging.create(principal, countryCode, input, meta);
  }

  @RequirePermission("packaging.manage")
  @Put("admin/packaging/presets/:id")
  update(@Param("id", uuid) id: string, @Body(new ZodValidationPipe(packagingPresetSchema)) input: PackagingPresetInput, @CurrentPrincipal() principal: AuthPrincipal, @Meta() meta: RequestMeta) {
    return this.packaging.update(principal, id, input, meta);
  }
}

@Controller({ path: "integration/orders", version: "1" })
@Public()
@UseGuards(ApiKeyGuard)
export class IntegrationOrdersController {
  constructor(private readonly orders: IntegrationOrdersService) {}

  @Throttle({ default: { limit: 120, ttl: 60_000 } })
  @Post()
  async place(@Body(new ZodValidationPipe(integrationOrderSchema)) input: IntegrationOrderInput, @CurrentApiClient() client: ApiClient, @Res({ passthrough: true }) response: Response) {
    const result = await this.orders.place(client, input);
    response.status(result.created ? HttpStatus.CREATED : HttpStatus.OK);
    return result.order;
  }

  @Throttle({ default: { limit: 240, ttl: 60_000 } })
  @Get(":externalReference")
  find(@Param("externalReference", referenceParam) externalReference: string, @CurrentApiClient() client: ApiClient) {
    return this.orders.find(client, externalReference);
  }
}

@Controller({ version: "1" })
@Public()
export class TrackingController {
  constructor(private readonly tracking: OrderTrackingService) {}

  @Throttle({ default: { limit: 60, ttl: 60_000 } })
  @Get("track/:trackingNumber")
  track(@Param("trackingNumber", trackingParam) trackingNumber: string) {
    return this.tracking.publicView(trackingNumber);
  }

  @Throttle({ default: { limit: 600, ttl: 60_000 } })
  @Post("webhooks/shippo/:accountKey/:token")
  @HttpCode(HttpStatus.OK)
  async shippo(@Param("accountKey", countryParam) accountKey: string, @Param("token", webhookToken) token: string, @Req() request: RawBodyRequest<Request>, @Body() body: unknown) {
    await this.tracking.webhook(accountKey, token, request.rawBody, body);
    return { received: true };
  }
}
