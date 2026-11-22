import { Controller, Get, Param, UseGuards } from "@nestjs/common";
import { Throttle } from "@nestjs/throttler";

import { Public } from "../../../common/auth/decorators";
import { ZodValidationPipe } from "../../../common/http/zod-validation.pipe";
import { isoCountryCode } from "../../../shared";
import { ApiKeyGuard, CurrentApiClient } from "./api-key.guard";
import type { ApiClient } from "./api-keys.service";
import { IntegrationCatalogService } from "./integration-catalog.service";

@Controller({ path: "integration", version: "1" })
@Public()
@UseGuards(ApiKeyGuard)
@Throttle({ default: { limit: 60, ttl: 60_000 } })
export class IntegrationCatalogController {
  constructor(private readonly catalog: IntegrationCatalogService) {}

  @Get("account")
  account(@CurrentApiClient() client: ApiClient) {
    return this.catalog.account(client);
  }

  @Get("stock/:country")
  stock(@Param("country", new ZodValidationPipe(isoCountryCode)) country: string, @CurrentApiClient() client: ApiClient) {
    return this.catalog.stock(client, country);
  }
}
