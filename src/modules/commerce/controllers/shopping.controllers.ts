import { Body, Controller, Get, HttpCode, HttpStatus, Param, ParseUUIDPipe, Post, Query, UseGuards } from "@nestjs/common";
import { Throttle } from "@nestjs/throttler";
import { z } from "zod";

import type { AuthPrincipal, RequestMeta } from "../../../common/auth/auth-principal";
import { CurrentPrincipal, Meta, Public, RequirePermission } from "../../../common/auth/decorators";
import { TrustedOriginGuard } from "../../../common/auth/trusted-origin.guard";
import { ZodValidationPipe } from "../../../common/http/zod-validation.pipe";
import { THROTTLE } from "../../../infrastructure/rate-limit/rate-limit.module";
import {
  type ShoppingArrivalInput,
  shoppingArrivalSchema,
  type ShoppingCancelInput,
  shoppingCancelSchema,
  type ShoppingCheckoutInput,
  shoppingCheckoutSchema,
  type ShoppingConfirmInput,
  shoppingConfirmSchema,
  type ShoppingPurchaseInput,
  shoppingPurchaseSchema,
  type ShoppingQuoteInput,
  shoppingQuoteSchema,
  type ShoppingRequestInput,
  shoppingRequestSchema,
  SHOPPING_STATUSES,
  type ShoppingStatus,
} from "../../../shared";
import { BuyerSessionGuard, CurrentBuyer } from "../buyers/buyer-session.guard";
import { ShoppingPaymentsService } from "../shopping/shopping-payments.service";
import { ShoppingPurchasesService } from "../shopping/shopping-purchases.service";
import { ShoppingQuotesService } from "../shopping/shopping-quotes.service";
import { ShoppingRequestsService } from "../shopping/shopping-requests.service";
import { ShoppingWarehouseService } from "../shopping/shopping-warehouse.service";

const uuid = new ParseUUIDPipe({ version: "4" });
const statusFilter = new ZodValidationPipe(z.enum(SHOPPING_STATUSES).optional());
const countryCode = new ZodValidationPipe(z.string().regex(/^[A-Z]{2}$/));
const reference = new ZodValidationPipe(z.string().regex(/^SHP-[A-Z]{2}-[A-Z0-9]{8}$/));

@Controller({ path: "public/shopping", version: "1" })
export class PublicShoppingController {
  constructor(private readonly requests: ShoppingRequestsService) {}

  @Public()
  @Throttle(THROTTLE.authStrict)
  @Post()
  create(@Body(new ZodValidationPipe(shoppingRequestSchema)) input: ShoppingRequestInput, @Meta() meta: RequestMeta) {
    return this.requests.create(input, meta);
  }

  @Public()
  @Throttle(THROTTLE.auth)
  @UseGuards(TrustedOriginGuard)
  @Post("confirm")
  @HttpCode(HttpStatus.OK)
  confirm(@Body(new ZodValidationPipe(shoppingConfirmSchema)) input: ShoppingConfirmInput, @Meta() meta: RequestMeta) {
    return this.requests.confirm(input.token, meta);
  }

  @Public()
  @Throttle(THROTTLE.publicRead)
  @Get("destinations/:code")
  destinations(@Param("code", countryCode) code: string) {
    return this.requests.destinations(code);
  }
}

@Public()
@UseGuards(BuyerSessionGuard)
@Throttle(THROTTLE.session)
@Controller({ path: "buyer/shopping", version: "1" })
export class BuyerShoppingController {
  constructor(
    private readonly requests: ShoppingRequestsService,
    private readonly payments: ShoppingPaymentsService,
  ) {}

  @Get()
  list(@CurrentBuyer() buyerId: string) {
    return this.requests.listForBuyer(buyerId);
  }

  @Get(":id")
  detail(@CurrentBuyer() buyerId: string, @Param("id", uuid) id: string) {
    return this.requests.buyerDetail(buyerId, id);
  }

  @UseGuards(TrustedOriginGuard)
  @Post(":id/cancel")
  @HttpCode(HttpStatus.OK)
  cancel(@CurrentBuyer() buyerId: string, @Param("id", uuid) id: string, @Meta() meta: RequestMeta) {
    return this.requests.cancelByBuyer(buyerId, id, meta);
  }

  @UseGuards(TrustedOriginGuard)
  @Throttle(THROTTLE.auth)
  @Post(":id/checkout")
  @HttpCode(HttpStatus.OK)
  checkout(@CurrentBuyer() buyerId: string, @Param("id", uuid) id: string, @Body(new ZodValidationPipe(shoppingCheckoutSchema)) input: ShoppingCheckoutInput, @Meta() meta: RequestMeta) {
    return this.payments.start(buyerId, id, input, meta);
  }

  @UseGuards(TrustedOriginGuard)
  @Throttle(THROTTLE.authStrict)
  @Post("by-reference/:reference/sandbox-payment")
  @HttpCode(HttpStatus.NO_CONTENT)
  sandbox(@CurrentBuyer() buyerId: string, @Param("reference", reference) ref: string) {
    return this.payments.completeSandbox(buyerId, ref);
  }
}

@Controller({ path: "admin/shopping", version: "1" })
export class AdminShoppingController {
  constructor(
    private readonly quotes: ShoppingQuotesService,
    private readonly purchases: ShoppingPurchasesService,
  ) {}

  @RequirePermission("shopping.read")
  @Get()
  list(@CurrentPrincipal() principal: AuthPrincipal, @Query("status", statusFilter) status?: ShoppingStatus) {
    return this.quotes.list(principal, status);
  }

  @RequirePermission("shopping.read")
  @Get(":id")
  detail(@CurrentPrincipal() principal: AuthPrincipal, @Param("id", uuid) id: string) {
    return this.quotes.detail(principal, id);
  }

  @RequirePermission("shopping.read")
  @Get(":id/photos/:fileId")
  photo(@CurrentPrincipal() principal: AuthPrincipal, @Param("id", uuid) id: string, @Param("fileId", uuid) fileId: string, @Meta() meta: RequestMeta) {
    return this.quotes.photo(principal, id, fileId, meta);
  }

  @RequirePermission("shopping.manage")
  @Post(":id/quote")
  @HttpCode(HttpStatus.OK)
  quote(@CurrentPrincipal() principal: AuthPrincipal, @Param("id", uuid) id: string, @Body(new ZodValidationPipe(shoppingQuoteSchema)) input: ShoppingQuoteInput, @Meta() meta: RequestMeta) {
    return this.quotes.quote(principal, id, input, meta);
  }

  @RequirePermission("shopping.manage")
  @Post(":id/purchase")
  @HttpCode(HttpStatus.OK)
  purchase(@CurrentPrincipal() principal: AuthPrincipal, @Param("id", uuid) id: string, @Body(new ZodValidationPipe(shoppingPurchaseSchema)) input: ShoppingPurchaseInput, @Meta() meta: RequestMeta) {
    return this.purchases.purchase(principal, id, input, meta);
  }

  @RequirePermission("shopping.manage")
  @Post(":id/cancel")
  @HttpCode(HttpStatus.OK)
  cancel(@CurrentPrincipal() principal: AuthPrincipal, @Param("id", uuid) id: string, @Body(new ZodValidationPipe(shoppingCancelSchema)) input: ShoppingCancelInput, @Meta() meta: RequestMeta) {
    return this.purchases.cancel(principal, id, input.reason, meta);
  }

  @RequirePermission("shopping.manage")
  @Post(":id/refund-retry")
  @HttpCode(HttpStatus.OK)
  retry(@CurrentPrincipal() principal: AuthPrincipal, @Param("id", uuid) id: string) {
    return this.purchases.retryRefund(principal, id);
  }
}

@Controller({ path: "warehouse/shopping", version: "1" })
export class WarehouseShoppingController {
  constructor(private readonly warehouse: ShoppingWarehouseService) {}

  @RequirePermission("inbound.read")
  @Get()
  list(@CurrentPrincipal() principal: AuthPrincipal) {
    return this.warehouse.list(principal);
  }

  @RequirePermission("inbound.receive")
  @Post(":id/arrival")
  @HttpCode(HttpStatus.OK)
  arrive(@CurrentPrincipal() principal: AuthPrincipal, @Param("id", uuid) id: string, @Body(new ZodValidationPipe(shoppingArrivalSchema)) input: ShoppingArrivalInput, @Meta() meta: RequestMeta) {
    return this.warehouse.arrive(principal, id, input, meta);
  }

  @RequirePermission("orders.fulfil")
  @Post(":id/ship")
  @HttpCode(HttpStatus.OK)
  ship(@CurrentPrincipal() principal: AuthPrincipal, @Param("id", uuid) id: string, @Meta() meta: RequestMeta) {
    return this.warehouse.ship(principal, id, meta);
  }

  @RequirePermission("orders.fulfil")
  @Post(":id/delivered")
  @HttpCode(HttpStatus.OK)
  delivered(@CurrentPrincipal() principal: AuthPrincipal, @Param("id", uuid) id: string, @Meta() meta: RequestMeta) {
    return this.warehouse.delivered(principal, id, meta);
  }
}
