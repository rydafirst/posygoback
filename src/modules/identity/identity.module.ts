import { Module } from "@nestjs/common";

import { IdentityChecksService } from "./identity-checks.service";
import { IdentityWebhooksController } from "./identity-webhooks.controller";
import { IDENTITY_CHECK_PROVIDERS } from "./providers/identity-check.providers";

@Module({ controllers: [IdentityWebhooksController], providers: [...IDENTITY_CHECK_PROVIDERS, IdentityChecksService], exports: [IdentityChecksService] })
export class IdentityModule {}
