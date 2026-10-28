import { Body, Controller, Get, Post } from "@nestjs/common";

import type { AuthPrincipal, RequestMeta } from "../../../common/auth/auth-principal";
import { CurrentPrincipal, Meta, RequirePermission } from "../../../common/auth/decorators";
import { ZodValidationPipe } from "../../../common/http/zod-validation.pipe";
import { type AddVendorCountryInput, addVendorCountrySchema } from "../../../shared";
import { VendorCountriesService } from "./vendor-countries.service";

@Controller({ path: "vendor/countries", version: "1" })
export class VendorCountriesController {
  constructor(private readonly countries: VendorCountriesService) {}

  @RequirePermission("vendor.portal.access")
  @Get()
  list(@CurrentPrincipal() principal: AuthPrincipal) {
    return this.countries.list(principal);
  }

  @RequirePermission("vendor.portal.access")
  @Get("figures")
  figures(@CurrentPrincipal() principal: AuthPrincipal) {
    return this.countries.figures(principal);
  }

  @RequirePermission("vendor.markets.manage")
  @Post()
  add(@Body(new ZodValidationPipe(addVendorCountrySchema)) input: AddVendorCountryInput, @CurrentPrincipal() principal: AuthPrincipal, @Meta() meta: RequestMeta) {
    return this.countries.add(principal, input.countryCode, meta);
  }
}
