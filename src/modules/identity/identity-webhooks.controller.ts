import { Controller, HttpCode, HttpStatus, Post, Req } from "@nestjs/common";
import type { RawBodyRequest } from "@nestjs/common";
import { Throttle } from "@nestjs/throttler";
import type { Request } from "express";

import { Public } from "../../common/auth/decorators";
import { Errors } from "../../common/http/app-exception";
import { IdentityChecksService } from "./identity-checks.service";
import { WebhookRejected } from "./providers/identity-check.port";

@Controller({ path: "webhooks", version: "1" })
export class IdentityWebhooksController {
  constructor(private readonly checks: IdentityChecksService) {}

  @Public()
  @Throttle({ default: { limit: 600, ttl: 60_000 } })
  @Post("didit")
  @HttpCode(HttpStatus.OK)
  async didit(@Req() request: RawBodyRequest<Request>) {
    await receiveIdentityWebhook(this.checks, "DIDIT", request);
    return { received: true };
  }
}

export async function receiveIdentityWebhook(checks: IdentityChecksService, from: string, request: RawBodyRequest<Request>): Promise<void> {
  if (!request.rawBody) {
    throw Errors.validation({ body: ["Empty request"] });
  }
  try {
    await checks.receiveWebhook(from, request.rawBody, request.headers);
  } catch (error) {
    if (error instanceof WebhookRejected) {
      throw Errors.validation({ signature: ["Signature could not be verified"] });
    }
    throw error;
  }
}
