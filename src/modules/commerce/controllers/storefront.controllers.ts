import { Body, Controller, Get, HttpCode, HttpStatus, Param, ParseUUIDPipe, Post, Put, Query, Res } from "@nestjs/common";
import { Throttle } from "@nestjs/throttler";
import type { Response } from "express";
import { z, type ZodType } from "zod";

import type { AuthPrincipal, RequestMeta } from "../../../common/auth/auth-principal";
import { CurrentPrincipal, Meta, Public, RequirePermission } from "../../../common/auth/decorators";
import { ZodValidationPipe } from "../../../common/http/zod-validation.pipe";
import { THROTTLE } from "../../../infrastructure/rate-limit/rate-limit.module";
import {
  type CheckoutInput,
  checkoutSchema,
  isoCountryCode,
  type ProductListingInput,
  productListingSchema,
  type QuoteInput,
  quoteSchema,
  STOREFRONT_ORDER_STATUSES,
  type StorefrontOrderStatus,
  type StorefrontSettingsInput,
  storefrontSettingsSchema,
} from "../../../shared";
import { CheckoutService } from "../checkout/checkout.service";
import { StorefrontOrdersService } from "../orders/storefront-orders.service";
import { StorefrontPayoutsService } from "../orders/storefront-payouts.service";
import { PublicStorefrontService } from "../storefront/public-storefront.service";
import { StorefrontListingsService } from "../storefront/storefront-listings.service";
import { StorefrontSettingsService } from "../storefront/storefront-settings.service";
import { VendorPayoutAccountService } from "../storefront/vendor-payout-account.service";

const uuid = new ParseUUIDPipe({ version: "4" });
const body = <Output>(schema: ZodType<Output>) => new ZodValidationPipe(schema);
const statusFilter = body(z.enum(STOREFRONT_ORDER_STATUSES).optional());
const slugParam = body(
  z
    .string()
    .trim()
    .toLowerCase()
    .regex(/^[a-z0-9-]{3,40}$/),
);
const referenceParam = body(z.string().regex(/^SF-[A-Z]{2}-[A-Z0-9]{8}$/));
const categoryFilter = body(z.string().trim().min(2).max(60).optional());
const refundSchema = z.object({ amountMinor: z.number().int().min(1).max(100_000_000), note: z.string().trim().min(5).max(500) });

@Controller({ path: "vendor/storefront", version: "1" })
export class VendorStorefrontController {
  constructor(
    private readonly settings: StorefrontSettingsService,
    private readonly listings: StorefrontListingsService,
    private readonly payouts: VendorPayoutAccountService,
    private readonly orders: StorefrontOrdersService,
  ) {}

  @RequirePermission("vendor.stock.read")
  @Get()
  view(@CurrentPrincipal() principal: AuthPrincipal) {
    return this.settings.view(principal);
  }

  @RequirePermission("vendor.storefront.manage")
  @Put()
  save(@Body(body(storefrontSettingsSchema)) input: StorefrontSettingsInput, @CurrentPrincipal() principal: AuthPrincipal, @Meta() meta: RequestMeta) {
    return this.settings.save(principal, input, meta);
  }

  @RequirePermission("vendor.storefront.manage")
  @Post("go-live")
  @HttpCode(HttpStatus.OK)
  goLive(@CurrentPrincipal() principal: AuthPrincipal, @Meta() meta: RequestMeta) {
    return this.settings.goLive(principal, meta);
  }

  @RequirePermission("vendor.storefront.manage")
  @Post("pause")
  @HttpCode(HttpStatus.OK)
  pause(@CurrentPrincipal() principal: AuthPrincipal, @Meta() meta: RequestMeta) {
    return this.settings.pause(principal, meta);
  }

  @RequirePermission("vendor.stock.read")
  @Get("listings")
  listingsView(@CurrentPrincipal() principal: AuthPrincipal) {
    return this.listings.list(principal);
  }

  @RequirePermission("vendor.storefront.manage")
  @Put("listings/:productId")
  setListing(@Param("productId", uuid) productId: string, @Body(body(productListingSchema)) input: ProductListingInput, @CurrentPrincipal() principal: AuthPrincipal, @Meta() meta: RequestMeta) {
    return this.listings.setListing(principal, productId, input, meta);
  }

  @RequirePermission("vendor.storefront.manage")
  @Throttle(THROTTLE.authStrict)
  @Post("payouts/setup")
  @HttpCode(HttpStatus.OK)
  setupPayouts(@CurrentPrincipal() principal: AuthPrincipal, @Meta() meta: RequestMeta) {
    return this.payouts.startSetup(principal, meta);
  }

  @RequirePermission("vendor.storefront.manage")
  @Post("payouts/refresh")
  @HttpCode(HttpStatus.OK)
  async refreshPayouts(@CurrentPrincipal() principal: AuthPrincipal) {
    await this.payouts.refreshOwn(principal);
    return this.settings.view(principal);
  }

  @RequirePermission("vendor.orders.read")
  @Get("orders")
  listOrders(@CurrentPrincipal() principal: AuthPrincipal, @Query("status", statusFilter) status?: StorefrontOrderStatus) {
    return this.orders.listForVendor(principal, status);
  }

  @RequirePermission("vendor.orders.read")
  @Get("orders/:id")
  order(@Param("id", uuid) id: string, @CurrentPrincipal() principal: AuthPrincipal) {
    return this.orders.vendorDetail(principal, id);
  }
}

@Controller({ path: "public", version: "1" })
export class PublicStorefrontController {
  constructor(
    private readonly published: PublicStorefrontService,
    private readonly checkout: CheckoutService,
  ) {}

  @Public()
  @Throttle(THROTTLE.publicRead)
  @Get("stores")
  stores() {
    return this.published.listing();
  }

  @Public()
  @Throttle(THROTTLE.publicRead)
  @Get("stores/:slug")
  store(@Param("slug", slugParam) slug: string) {
    return this.published.store(slug);
  }

  @Public()
  @Throttle(THROTTLE.publicRead)
  @Get("marketplace/:countryCode")
  marketplace(@Param("countryCode", body(isoCountryCode)) countryCode: string, @Query("category", categoryFilter) category?: string) {
    return this.published.marketplace(countryCode, category);
  }

  @Public()
  @Throttle(THROTTLE.publicRead)
  @Get("products/:id/image")
  async image(@Param("id", uuid) id: string, @Res() response: Response) {
    response.redirect(HttpStatus.FOUND, await this.published.imageUrl(id));
  }

  @Public()
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  @Post("stores/:slug/quote")
  @HttpCode(HttpStatus.OK)
  quote(@Param("slug", slugParam) slug: string, @Body(body(quoteSchema)) input: QuoteInput) {
    return this.checkout.quote(slug, input);
  }

  @Public()
  @Throttle(THROTTLE.authStrict)
  @Post("stores/:slug/checkout")
  @HttpCode(HttpStatus.OK)
  start(@Param("slug", slugParam) slug: string, @Body(body(checkoutSchema)) input: CheckoutInput, @Meta() meta: RequestMeta) {
    return this.checkout.start(slug, input, meta);
  }

  @Public()
  @Throttle(THROTTLE.publicRead)
  @Get("storefront-orders/:id")
  receipt(@Param("id", uuid) id: string) {
    return this.checkout.receipt(id);
  }

  @Public()
  @Throttle(THROTTLE.authStrict)
  @Post("storefront-orders/:reference/sandbox-payment")
  @HttpCode(HttpStatus.OK)
  sandboxPay(@Param("reference", referenceParam) reference: string) {
    return this.checkout.completeSandbox(reference);
  }
}

@Controller({ path: "admin/storefront-orders", version: "1" })
export class AdminStorefrontOrdersController {
  constructor(
    private readonly orders: StorefrontOrdersService,
    private readonly payouts: StorefrontPayoutsService,
  ) {}

  @RequirePermission("storefronts.read")
  @Get()
  list(@CurrentPrincipal() principal: AuthPrincipal, @Query("status", statusFilter) status?: StorefrontOrderStatus) {
    return this.orders.listForStaff(principal, status);
  }

  @RequirePermission("storefronts.read")
  @Get(":id")
  detail(@Param("id", uuid) id: string, @CurrentPrincipal() principal: AuthPrincipal) {
    return this.orders.staffDetail(principal, id);
  }

  @RequirePermission("storefronts.manage")
  @Post(":id/refund")
  @HttpCode(HttpStatus.OK)
  refund(@Param("id", uuid) id: string, @Body(body(refundSchema)) input: { amountMinor: number; note: string }, @CurrentPrincipal() principal: AuthPrincipal) {
    return this.orders.refund(principal, id, input.amountMinor, input.note);
  }

  @RequirePermission("storefronts.manage")
  @Post(":id/payout-retry")
  @HttpCode(HttpStatus.OK)
  async retryPayout(@Param("id", uuid) id: string, @CurrentPrincipal() principal: AuthPrincipal, @Meta() meta: RequestMeta) {
    await this.payouts.retry(principal, id, meta);
    return this.orders.staffDetail(principal, id);
  }
}
