import { Body, Controller, Get, HttpCode, HttpStatus, Param, ParseUUIDPipe, Post } from "@nestjs/common";
import { Throttle } from "@nestjs/throttler";

import type { AuthPrincipal, RequestMeta } from "../../common/auth/auth-principal";
import { CurrentPrincipal, Meta } from "../../common/auth/decorators";
import { ZodValidationPipe } from "../../common/http/zod-validation.pipe";
import { THROTTLE } from "../../infrastructure/rate-limit/rate-limit.module";
import { type CreateUploadInput, createUploadSchema } from "./file-policy";
import { FilesService } from "./files.service";

@Controller({ path: "files", version: "1" })
export class FilesController {
  constructor(private readonly files: FilesService) {}

  @Throttle(THROTTLE.uploads)
  @Post("uploads")
  create(@Body(new ZodValidationPipe(createUploadSchema)) input: CreateUploadInput, @CurrentPrincipal() principal: AuthPrincipal) {
    return this.files.createUpload(input, principal);
  }

  @Throttle(THROTTLE.uploads)
  @Post(":id/confirm")
  @HttpCode(HttpStatus.OK)
  confirm(@Param("id", new ParseUUIDPipe({ version: "4" })) id: string, @CurrentPrincipal() principal: AuthPrincipal, @Meta() meta: RequestMeta) {
    return this.files.confirm(id, principal, meta);
  }

  @Get(":id/download-url")
  download(@Param("id", new ParseUUIDPipe({ version: "4" })) id: string, @CurrentPrincipal() principal: AuthPrincipal, @Meta() meta: RequestMeta) {
    return this.files.downloadUrl(id, principal, meta);
  }
}
