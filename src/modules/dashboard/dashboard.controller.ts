import { Controller, Get, Query } from "@nestjs/common";
import { z } from "zod";

import type { AuthPrincipal } from "../../common/auth/auth-principal";
import { CurrentPrincipal } from "../../common/auth/decorators";
import { ZodValidationPipe } from "../../common/http/zod-validation.pipe";
import { DashboardService } from "./dashboard.service";

const countryFilter = new ZodValidationPipe(
  z
    .string()
    .regex(/^[A-Z]{2}$/)
    .optional(),
);

@Controller({ path: "admin/dashboard", version: "1" })
export class DashboardController {
  constructor(private readonly dashboard: DashboardService) {}

  @Get()
  view(@CurrentPrincipal() principal: AuthPrincipal, @Query("country", countryFilter) country?: string) {
    return this.dashboard.view(principal, country);
  }
}
