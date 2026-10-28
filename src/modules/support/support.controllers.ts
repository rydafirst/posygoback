import { Body, Controller, Get, HttpCode, HttpStatus, Param, ParseUUIDPipe, Post, Query } from "@nestjs/common";
import { Throttle } from "@nestjs/throttler";
import { z } from "zod";

import type { AuthPrincipal, RequestMeta } from "../../common/auth/auth-principal";
import { AllowPendingMfa, CurrentPrincipal, Meta, Public, RequirePermission } from "../../common/auth/decorators";
import { ZodValidationPipe } from "../../common/http/zod-validation.pipe";
import { THROTTLE } from "../../infrastructure/rate-limit/rate-limit.module";
import {
  type ResolveSupportCaseInput,
  resolveSupportCaseSchema,
  SUPPORT_CASE_KINDS,
  SUPPORT_CASE_STATUSES,
  type SupportCaseKind,
  type SupportCaseStatus,
  type SupportReport,
  supportReportSchema,
} from "../../shared";
import { SupportCasesRepository } from "./support-cases.repository";
import { SupportCasesService } from "./support-cases.service";

const uuid = new ParseUUIDPipe({ version: "4" });
const reportPipe = new ZodValidationPipe(supportReportSchema);
const statusFilter = new ZodValidationPipe(z.enum(SUPPORT_CASE_STATUSES).optional());
const kindFilter = new ZodValidationPipe(z.enum(SUPPORT_CASE_KINDS).optional());

@Controller({ path: "public/support-cases", version: "1" })
export class PublicSupportController {
  constructor(private readonly cases: SupportCasesService) {}

  @Public()
  @Throttle(THROTTLE.auth)
  @Post()
  report(@Body(reportPipe) input: SupportReport, @Meta() meta: RequestMeta) {
    return this.cases.report(input, meta, null);
  }
}

@Controller({ path: "support-cases", version: "1" })
export class SupportController {
  constructor(private readonly cases: SupportCasesService) {}

  @AllowPendingMfa()
  @Throttle(THROTTLE.auth)
  @Post()
  report(@Body(reportPipe) input: SupportReport, @Meta() meta: RequestMeta, @CurrentPrincipal() principal: AuthPrincipal) {
    return this.cases.report(input, meta, principal);
  }
}

@Controller({ path: "admin/support-cases", version: "1" })
export class AdminSupportController {
  constructor(
    private readonly cases: SupportCasesService,
    private readonly repository: SupportCasesRepository,
  ) {}

  @RequirePermission("support.read")
  @Get()
  list(@Query("status", statusFilter) status: SupportCaseStatus | undefined, @Query("kind", kindFilter) kind: SupportCaseKind | undefined) {
    return this.repository.list(status, kind);
  }

  @RequirePermission("support.read")
  @Get(":id")
  detail(@Param("id", uuid) id: string) {
    return this.repository.detail(id);
  }

  @RequirePermission("support.manage")
  @Post(":id/resolve")
  @HttpCode(HttpStatus.OK)
  async resolve(
    @Param("id", uuid) id: string,
    @Body(new ZodValidationPipe(resolveSupportCaseSchema)) input: ResolveSupportCaseInput,
    @CurrentPrincipal() principal: AuthPrincipal,
    @Meta() meta: RequestMeta,
  ) {
    await this.cases.resolve(id, input.note, { userId: principal.userId, role: principal.role }, meta);
    return this.repository.detail(id);
  }
}
