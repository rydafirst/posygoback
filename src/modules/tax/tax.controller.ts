import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post } from "@nestjs/common";

import type { AuthPrincipal, RequestMeta } from "../../common/auth/auth-principal";
import { CurrentPrincipal, Meta, RequirePermission } from "../../common/auth/decorators";
import { ZodValidationPipe } from "../../common/http/zod-validation.pipe";
import {
  type CreateTaxObligationInput,
  createTaxObligationSchema,
  type FileTaxDeadlineInput,
  fileTaxDeadlineSchema,
  isoCountryCode,
  type ScheduleTaxDeadlineInput,
  scheduleTaxDeadlineSchema,
  type UpdateTaxObligationInput,
  updateTaxObligationSchema,
} from "../../shared";
import { TaxObligationsService } from "./tax-obligations.service";

const uuid = new ParseUUIDPipe({ version: "4" });
const CountryCodePipe = new ZodValidationPipe(isoCountryCode);

@RequirePermission("tax.manage")
@Controller({ path: "admin/tax", version: "1" })
export class AdminTaxController {
  constructor(private readonly tax: TaxObligationsService) {}

  @Get()
  overview() {
    return this.tax.overview();
  }

  @Get("countries/:code")
  country(@Param("code", CountryCodePipe) code: string) {
    return this.tax.country(code);
  }

  @Post("countries/:code/checklist")
  checklist(@Param("code", CountryCodePipe) code: string, @CurrentPrincipal() principal: AuthPrincipal, @Meta() meta: RequestMeta) {
    return this.tax.applyChecklist(principal, code, meta);
  }

  @Post("countries/:code/obligations")
  create(
    @Param("code", CountryCodePipe) code: string,
    @Body(new ZodValidationPipe(createTaxObligationSchema)) input: CreateTaxObligationInput,
    @CurrentPrincipal() principal: AuthPrincipal,
    @Meta() meta: RequestMeta,
  ) {
    return this.tax.create(principal, code, input, meta);
  }

  @Patch("obligations/:id")
  update(@Param("id", uuid) id: string, @Body(new ZodValidationPipe(updateTaxObligationSchema)) input: UpdateTaxObligationInput, @CurrentPrincipal() principal: AuthPrincipal, @Meta() meta: RequestMeta) {
    return this.tax.update(principal, id, input, meta);
  }

  @Post("obligations/:id/deadlines")
  schedule(@Param("id", uuid) id: string, @Body(new ZodValidationPipe(scheduleTaxDeadlineSchema)) input: ScheduleTaxDeadlineInput, @CurrentPrincipal() principal: AuthPrincipal, @Meta() meta: RequestMeta) {
    return this.tax.schedule(principal, id, input, meta);
  }

  @Patch("deadlines/:id")
  move(@Param("id", uuid) id: string, @Body(new ZodValidationPipe(scheduleTaxDeadlineSchema)) input: ScheduleTaxDeadlineInput, @CurrentPrincipal() principal: AuthPrincipal, @Meta() meta: RequestMeta) {
    return this.tax.move(principal, id, input, meta);
  }

  @Post("deadlines/:id/file")
  file(@Param("id", uuid) id: string, @Body(new ZodValidationPipe(fileTaxDeadlineSchema)) input: FileTaxDeadlineInput, @CurrentPrincipal() principal: AuthPrincipal, @Meta() meta: RequestMeta) {
    return this.tax.file(principal, id, input, meta);
  }
}
