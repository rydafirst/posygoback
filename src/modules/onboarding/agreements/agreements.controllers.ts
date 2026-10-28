import { Body, Controller, Get, HttpCode, HttpStatus, Param, ParseUUIDPipe, Post, Query } from "@nestjs/common";
import { Throttle } from "@nestjs/throttler";
import { type AcceptAgreementInput, acceptAgreementSchema, type CreateLegalDocumentInput, createLegalDocumentSchema, LEGAL_DOCUMENT_KINDS, type LegalDocumentKind } from "../../../shared";
import { z } from "zod";

import type { AuthPrincipal, RequestMeta } from "../../../common/auth/auth-principal";
import { CurrentPrincipal, Meta, Public, RequirePermission } from "../../../common/auth/decorators";
import { ZodValidationPipe } from "../../../common/http/zod-validation.pipe";
import { THROTTLE } from "../../../infrastructure/rate-limit/rate-limit.module";
import { AgreementsService } from "./agreements.service";

const countryParam = new ZodValidationPipe(z.string().regex(/^[A-Z]{2}$/));
const optionalCountry = new ZodValidationPipe(
  z
    .string()
    .regex(/^[A-Z]{2}$/)
    .optional(),
);
const kindParam = new ZodValidationPipe(z.enum(LEGAL_DOCUMENT_KINDS));
const acceptPipe = new ZodValidationPipe(acceptAgreementSchema);

@Controller({ path: "vendor/agreements", version: "1" })
export class VendorAgreementsController {
  constructor(private readonly agreements: AgreementsService) {}

  @RequirePermission("vendor.portal.access")
  @Get()
  required(@CurrentPrincipal() principal: AuthPrincipal) {
    return this.agreements.requiredFor(principal);
  }

  @RequirePermission("vendor.verification.manage")
  @Post(":documentId/accept")
  @HttpCode(HttpStatus.OK)
  accept(
    @Param("documentId", new ParseUUIDPipe({ version: "4" })) documentId: string,
    @Body(acceptPipe) input: AcceptAgreementInput,
    @CurrentPrincipal() principal: AuthPrincipal,
    @Meta() meta: RequestMeta,
  ) {
    return this.agreements.accept(principal, documentId, input, meta);
  }
}

@Controller({ path: "legal", version: "1" })
export class PublicLegalController {
  constructor(private readonly agreements: AgreementsService) {}

  @Public()
  @Throttle(THROTTLE.publicRead)
  @Get(":countryCode/:kind")
  latest(@Param("countryCode", countryParam) countryCode: string, @Param("kind", kindParam) kind: LegalDocumentKind) {
    return this.agreements.publicLatest(countryCode, kind);
  }
}

@Controller({ path: "admin/legal-documents", version: "1" })
export class AdminLegalController {
  constructor(private readonly agreements: AgreementsService) {}

  @RequirePermission("legal.manage")
  @Get()
  list(@Query("country", optionalCountry) countryCode?: string) {
    return this.agreements.list(countryCode);
  }

  @RequirePermission("legal.manage")
  @Post()
  publish(@Body(new ZodValidationPipe(createLegalDocumentSchema)) input: CreateLegalDocumentInput, @CurrentPrincipal() principal: AuthPrincipal, @Meta() meta: RequestMeta) {
    return this.agreements.publish(input, principal, meta);
  }
}
