import { Controller, Get, Param } from "@nestjs/common";
import { Throttle } from "@nestjs/throttler";

import { Public } from "../../../common/auth/decorators";
import { ZodValidationPipe } from "../../../common/http/zod-validation.pipe";
import { THROTTLE } from "../../../infrastructure/rate-limit/rate-limit.module";
import { isoCountryCode } from "../../../shared";
import { PublicPricesService } from "./public-prices.service";

@Controller({ path: "public/prices", version: "1" })
export class PublicPricesController {
  constructor(private readonly prices: PublicPricesService) {}

  @Public()
  @Throttle(THROTTLE.publicRead)
  @Get(":countryCode")
  forCountry(@Param("countryCode", new ZodValidationPipe(isoCountryCode)) countryCode: string) {
    return this.prices.forCountry(countryCode);
  }
}
