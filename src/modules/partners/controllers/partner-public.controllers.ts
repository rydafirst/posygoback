import { Body, Controller, Get, Headers, HttpCode, HttpStatus, Post, Req } from "@nestjs/common";
import type { RawBodyRequest } from "@nestjs/common";
import { Throttle } from "@nestjs/throttler";
import type { Request } from "express";

import type { RequestMeta } from "../../../common/auth/auth-principal";
import { Meta, Public } from "../../../common/auth/decorators";
import { Errors } from "../../../common/http/app-exception";
import { ZodValidationPipe } from "../../../common/http/zod-validation.pipe";
import { THROTTLE } from "../../../infrastructure/rate-limit/rate-limit.module";
import { type PartnerApplicationInput, partnerApplicationSchema } from "../../../shared";
import { PartnerPayoutAccountService } from "../portal/partner-payout-account.service";
import { PartnerVerificationService } from "../portal/partner-verification.service";
import { WebhookRejected } from "../providers/partner-services.port";
import { PartnerApplicationsService } from "../public/partner-applications.service";
import { PartnerPublicService } from "../public/partner-public.service";

@Controller({ path: "public", version: "1" })
export class PartnerPublicController {
  constructor(
    private readonly published: PartnerPublicService,
    private readonly applications: PartnerApplicationsService,
  ) {}

  @Public()
  @Throttle(THROTTLE.publicRead)
  @Get("hubs")
  hubs() {
    return this.published.hubs();
  }

  @Public()
  @Throttle(THROTTLE.publicRead)
  @Get("partner-programme")
  programme() {
    return this.published.programmes();
  }

  @Public()
  @Throttle(THROTTLE.authStrict)
  @Post("partner-applications")
  @HttpCode(HttpStatus.ACCEPTED)
  async apply(@Body(new ZodValidationPipe(partnerApplicationSchema)) input: PartnerApplicationInput, @Meta() meta: RequestMeta) {
    await this.applications.apply(input, meta);
    return { status: "RECEIVED" };
  }
}

@Controller({ path: "webhooks", version: "1" })
export class PartnerWebhooksController {
  constructor(
    private readonly verification: PartnerVerificationService,
    private readonly payouts: PartnerPayoutAccountService,
  ) {}

  @Public()
  @Throttle({ default: { limit: 600, ttl: 60_000 } })
  @Post("stripe-identity")
  @HttpCode(HttpStatus.OK)
  async identity(@Req() request: RawBodyRequest<Request>, @Headers("stripe-signature") signature?: string) {
    await this.verified(() => this.verification.identityWebhook(this.body(request), signature ?? ""));
    return { received: true };
  }

  @Public()
  @Throttle({ default: { limit: 600, ttl: 60_000 } })
  @Post("stripe-connect")
  @HttpCode(HttpStatus.OK)
  async connect(@Req() request: RawBodyRequest<Request>, @Headers("stripe-signature") signature?: string) {
    await this.verified(() => this.payouts.webhook(this.body(request), signature ?? ""));
    return { received: true };
  }

  private body(request: RawBodyRequest<Request>): Buffer {
    if (!request.rawBody) {
      throw Errors.validation({ body: ["Empty request"] });
    }
    return request.rawBody;
  }

  private async verified(work: () => Promise<void>): Promise<void> {
    try {
      await work();
    } catch (error) {
      if (error instanceof WebhookRejected) {
        throw Errors.validation({ signature: ["Signature could not be verified"] });
      }
      throw error;
    }
  }
}
