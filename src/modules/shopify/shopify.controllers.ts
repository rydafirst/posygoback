import { Body, Controller, Get, Headers, HttpCode, HttpStatus, Logger, Post, Query, Req, UseGuards } from "@nestjs/common";
import type { RawBodyRequest } from "@nestjs/common";
import { Throttle } from "@nestjs/throttler";
import type { Request } from "express";

import { Public } from "../../common/auth/decorators";
import { Errors } from "../../common/http/app-exception";
import { ZodValidationPipe } from "../../common/http/zod-validation.pipe";
import { THROTTLE } from "../../infrastructure/rate-limit/rate-limit.module";
import { type ShopifyConnectInput, shopifyConnectSchema, type ShopifyPreviewInput, shopifyPreviewSchema } from "../../shared";
import { ShopifyAdminClient } from "./shopify-admin.client";
import { ShopifyFulfilmentService, type ShopifyNotificationKind } from "./shopify-fulfilment.service";
import { CurrentShopifySession, ShopifySessionGuard } from "./shopify-session.guard";
import { isShopDomain } from "./shopify-session-token";
import { ShopifyShopsService } from "./shopify-shops.service";
import { shopifySignatureMatches } from "./shopify-signatures";
import { isShopifyWebhookTopic, ShopifyWebhooksService } from "./shopify-webhooks.service";

const NOTIFICATION_KINDS: ShopifyNotificationKind[] = ["FULFILLMENT_REQUEST", "CANCELLATION_REQUEST"];

function rawBodyOf(request: RawBodyRequest<Request>): Buffer {
  return Buffer.isBuffer(request.body) ? request.body : (request.rawBody ?? Buffer.alloc(0));
}

function parse(rawBody: Buffer): unknown {
  try {
    return JSON.parse(rawBody.toString("utf8"));
  } catch {
    return null;
  }
}

@Controller({ path: "shopify", version: "1" })
@Public()
@UseGuards(ShopifySessionGuard)
@Throttle({ default: { limit: 60, ttl: 60_000 } })
export class ShopifyAppController {
  constructor(private readonly shops: ShopifyShopsService) {}

  @Post("session")
  @HttpCode(HttpStatus.OK)
  open(@CurrentShopifySession() session: { shopDomain: string; sessionToken: string }) {
    return this.shops.open(session.shopDomain, session.sessionToken);
  }

  @Post("preview")
  @HttpCode(HttpStatus.OK)
  @Throttle(THROTTLE.authStrict)
  preview(@Body(new ZodValidationPipe(shopifyPreviewSchema)) input: ShopifyPreviewInput) {
    return this.shops.preview(input.apiKey);
  }

  @Post("connect")
  @HttpCode(HttpStatus.OK)
  @Throttle(THROTTLE.authStrict)
  connect(@CurrentShopifySession() session: { shopDomain: string }, @Body(new ZodValidationPipe(shopifyConnectSchema)) input: ShopifyConnectInput) {
    return this.shops.connect(session.shopDomain, input);
  }

  @Post("disconnect")
  @HttpCode(HttpStatus.OK)
  disconnect(@CurrentShopifySession() session: { shopDomain: string }) {
    return this.shops.disconnect(session.shopDomain);
  }
}

@Controller({ path: "shopify/fulfilment", version: "1" })
@Public()
@Throttle({ default: { limit: 600, ttl: 60_000 } })
export class ShopifyFulfilmentController {
  private readonly logger = new Logger(ShopifyFulfilmentController.name);

  constructor(
    private readonly shopify: ShopifyAdminClient,
    private readonly fulfilment: ShopifyFulfilmentService,
  ) {}

  @Post("fulfillment_order_notification")
  @HttpCode(HttpStatus.CREATED)
  notify(@Req() request: RawBodyRequest<Request>, @Headers("x-shopify-shop-domain") shopDomain: string | undefined) {
    const rawBody = rawBodyOf(request);
    if (!isShopDomain(shopDomain) || !shopifySignatureMatches(rawBody, this.shopify.secret, request.headers["x-shopify-hmac-sha256"])) {
      throw Errors.unauthenticated("Signature could not be verified.");
    }
    const kind = (parse(rawBody) as { kind?: unknown } | null)?.kind;
    if (NOTIFICATION_KINDS.includes(kind as ShopifyNotificationKind)) {
      void this.fulfilment.notify(shopDomain, kind as ShopifyNotificationKind).catch((error: unknown) => {
        this.logger.warn(`Shopify ${String(kind)} for ${shopDomain} failed: ${error instanceof Error ? error.message : String(error)}`);
      });
    }
    return { received: true };
  }

  @Get("fetch_stock")
  fetchStock(@Query("shop") shopDomain: unknown, @Query("sku") sku: unknown) {
    if (!isShopDomain(shopDomain)) {
      throw Errors.notFound();
    }
    return this.fulfilment.stock(shopDomain, typeof sku === "string" && sku ? sku : undefined);
  }
}

@Controller({ path: "shopify/webhooks", version: "1" })
@Public()
@Throttle({ default: { limit: 600, ttl: 60_000 } })
export class ShopifyWebhooksController {
  constructor(
    private readonly shopify: ShopifyAdminClient,
    private readonly webhooks: ShopifyWebhooksService,
  ) {}

  @Post()
  @HttpCode(HttpStatus.OK)
  async receive(@Req() request: RawBodyRequest<Request>, @Headers("x-shopify-shop-domain") shopDomain: string | undefined, @Headers("x-shopify-topic") topic: string | undefined) {
    const rawBody = rawBodyOf(request);
    if (!isShopDomain(shopDomain) || !shopifySignatureMatches(rawBody, this.shopify.secret, request.headers["x-shopify-hmac-sha256"])) {
      throw Errors.unauthenticated("Signature could not be verified.");
    }
    if (isShopifyWebhookTopic(topic)) {
      await this.webhooks.handle(shopDomain, topic, parse(rawBody));
    }
    return { received: true };
  }
}
