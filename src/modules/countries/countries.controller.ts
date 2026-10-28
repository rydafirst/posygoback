import { Body, Controller, Get, Param, Patch, Post } from "@nestjs/common";
import { Throttle } from "@nestjs/throttler";
import { changeCountryStatusSchema, createCountrySchema, updateCountrySchema, type ChangeCountryStatusInput, type CreateCountryInput, type UpdateCountryInput } from "../../shared";
import { z } from "zod";

import type { AuthPrincipal, RequestMeta } from "../../common/auth/auth-principal";
import { CurrentPrincipal, Meta, Public, RequirePermission } from "../../common/auth/decorators";
import { ZodValidationPipe } from "../../common/http/zod-validation.pipe";
import { THROTTLE } from "../../infrastructure/rate-limit/rate-limit.module";
import { CountriesService } from "./countries.service";

const countryCodeParam = new ZodValidationPipe(z.string().regex(/^[A-Z]{2}$/));

@Controller({ path: "countries", version: "1" })
export class CountriesController {
  constructor(private readonly countries: CountriesService) {}

  @Public()
  @Throttle(THROTTLE.publicRead)
  @Get()
  listLive() {
    return this.countries.listLive();
  }
}

@Controller({ path: "admin/countries", version: "1" })
export class AdminCountriesController {
  constructor(private readonly countries: CountriesService) {}

  @RequirePermission("countries.read")
  @Get()
  list() {
    return this.countries.listAll();
  }

  @RequirePermission("countries.read")
  @Get(":code")
  get(@Param("code", countryCodeParam) code: string) {
    return this.countries.get(code);
  }

  @RequirePermission("countries.manage")
  @Post()
  create(@Body(new ZodValidationPipe(createCountrySchema)) input: CreateCountryInput, @CurrentPrincipal() principal: AuthPrincipal, @Meta() meta: RequestMeta) {
    return this.countries.create(input, principal, meta);
  }

  @RequirePermission("countries.manage")
  @Patch(":code")
  update(
    @Param("code", countryCodeParam) code: string,
    @Body(new ZodValidationPipe(updateCountrySchema)) input: UpdateCountryInput,
    @CurrentPrincipal() principal: AuthPrincipal,
    @Meta() meta: RequestMeta,
  ) {
    return this.countries.update(code, input, principal, meta);
  }

  @RequirePermission("countries.manage")
  @Post(":code/status")
  changeStatus(
    @Param("code", countryCodeParam) code: string,
    @Body(new ZodValidationPipe(changeCountryStatusSchema)) input: ChangeCountryStatusInput,
    @CurrentPrincipal() principal: AuthPrincipal,
    @Meta() meta: RequestMeta,
  ) {
    return this.countries.changeStatus(code, input, principal, meta);
  }
}
