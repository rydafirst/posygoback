import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, Put } from "@nestjs/common";

import type { AuthPrincipal } from "../../common/auth/auth-principal";
import { CurrentPrincipal } from "../../common/auth/decorators";
import { ZodValidationPipe } from "../../common/http/zod-validation.pipe";
import { draftKeySchema, type SaveDraftInput, saveDraftSchema } from "../../shared";
import { DraftsService } from "./drafts.service";

const keyPipe = new ZodValidationPipe(draftKeySchema);
const savePipe = new ZodValidationPipe(saveDraftSchema);

@Controller({ path: "drafts", version: "1" })
export class DraftsController {
  constructor(private readonly drafts: DraftsService) {}

  @Get(":key")
  find(@CurrentPrincipal() principal: AuthPrincipal, @Param("key", keyPipe) key: string) {
    return this.drafts.find(principal.userId, key);
  }

  @Put(":key")
  save(@CurrentPrincipal() principal: AuthPrincipal, @Param("key", keyPipe) key: string, @Body(savePipe) input: SaveDraftInput) {
    return this.drafts.save(principal.userId, key, input.data);
  }

  @Delete(":key")
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(@CurrentPrincipal() principal: AuthPrincipal, @Param("key", keyPipe) key: string) {
    return this.drafts.remove(principal.userId, key);
  }
}
