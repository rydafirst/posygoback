import { Body, Controller, Get, HttpCode, HttpStatus, Inject, Param, ParseUUIDPipe, Post, Req, Res, UseGuards } from "@nestjs/common";
import { Throttle } from "@nestjs/throttler";
import type { Request, Response } from "express";

import type { RequestMeta } from "../../../common/auth/auth-principal";
import { Meta, Public } from "../../../common/auth/decorators";
import { TrustedOriginGuard } from "../../../common/auth/trusted-origin.guard";
import { ZodValidationPipe } from "../../../common/http/zod-validation.pipe";
import { APP_CONFIG } from "../../../config/config.module";
import type { AppConfig } from "../../../config/config.schema";
import { THROTTLE } from "../../../infrastructure/rate-limit/rate-limit.module";
import { type BuyerLinkInput, buyerLinkSchema, type BuyerSessionInput, buyerSessionSchema, type BuyerView, type ReturnRequestInput, returnRequestSchema } from "../../../shared";
import { BuyerAuthService } from "../buyers/buyer-auth.service";
import { clearBuyerCookie, readBuyerCookie, setBuyerCookie } from "../buyers/buyer-cookie";
import { BuyerSessionGuard, CurrentBuyer } from "../buyers/buyer-session.guard";
import { StorefrontOrdersService } from "../orders/storefront-orders.service";
import { StorefrontReturnsService } from "../returns/storefront-returns.service";

const uuid = new ParseUUIDPipe({ version: "4" });

@Public()
@Controller({ path: "buyer/auth", version: "1" })
export class BuyerAuthController {
  constructor(
    private readonly auth: BuyerAuthService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  @Throttle(THROTTLE.authStrict)
  @UseGuards(TrustedOriginGuard)
  @Post("link")
  @HttpCode(HttpStatus.ACCEPTED)
  async link(@Body(new ZodValidationPipe(buyerLinkSchema)) input: BuyerLinkInput, @Meta() meta: RequestMeta) {
    await this.auth.requestLink(input.email, meta);
    return { status: "SENT_IF_KNOWN" };
  }

  @Throttle(THROTTLE.auth)
  @UseGuards(TrustedOriginGuard)
  @Post("session")
  @HttpCode(HttpStatus.OK)
  async session(@Body(new ZodValidationPipe(buyerSessionSchema)) input: BuyerSessionInput, @Meta() meta: RequestMeta, @Res({ passthrough: true }) response: Response): Promise<BuyerView> {
    const started = await this.auth.startSession(input.token, meta);
    setBuyerCookie(response, started.sessionToken, this.config);
    return started.buyer;
  }

  @Throttle(THROTTLE.session)
  @UseGuards(TrustedOriginGuard)
  @Post("sign-out")
  @HttpCode(HttpStatus.NO_CONTENT)
  async signOut(@Req() request: Request, @Res({ passthrough: true }) response: Response): Promise<void> {
    await this.auth.signOut(readBuyerCookie(request));
    clearBuyerCookie(response, this.config);
  }
}

@Public()
@UseGuards(BuyerSessionGuard)
@Throttle(THROTTLE.session)
@Controller({ path: "buyer", version: "1" })
export class BuyerAccountController {
  constructor(
    private readonly auth: BuyerAuthService,
    private readonly orders: StorefrontOrdersService,
    private readonly returns: StorefrontReturnsService,
  ) {}

  @Get("me")
  me(@CurrentBuyer() buyerId: string) {
    return this.auth.me(buyerId);
  }

  @Get("orders")
  list(@CurrentBuyer() buyerId: string) {
    return this.orders.listForBuyer(buyerId);
  }

  @Get("orders/:id")
  detail(@CurrentBuyer() buyerId: string, @Param("id", uuid) id: string) {
    return this.orders.buyerDetail(buyerId, id);
  }

  @UseGuards(TrustedOriginGuard)
  @Post("orders/:id/returns")
  request(@CurrentBuyer() buyerId: string, @Param("id", uuid) id: string, @Body(new ZodValidationPipe(returnRequestSchema)) input: ReturnRequestInput, @Meta() meta: RequestMeta) {
    return this.returns.request(buyerId, id, input.reason, meta);
  }
}
