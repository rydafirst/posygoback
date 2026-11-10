import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Query } from "@nestjs/common";
import { Throttle } from "@nestjs/throttler";
import { z } from "zod";

import type { AuthPrincipal, RequestMeta } from "../../common/auth/auth-principal";
import { CurrentPrincipal, Meta, Public, RequirePermission } from "../../common/auth/decorators";
import { ZodValidationPipe } from "../../common/http/zod-validation.pipe";
import { THROTTLE } from "../../infrastructure/rate-limit/rate-limit.module";
import {
  type ImportOutreachInput,
  importOutreachSchema,
  type OutreachContactInput,
  outreachContactSchema,
  type OutreachListQuery,
  outreachListSchema,
  OUTREACH_TEMPLATES,
  type SendOutreachInput,
  sendOutreachSchema,
  type UpdateOutreachContactInput,
  updateOutreachContactSchema,
} from "../../shared";
import { OutreachContactsService } from "./outreach-contacts.service";
import { OutreachOptOutsService } from "./outreach-opt-outs.service";
import { OutreachSenderService } from "./outreach-sender.service";

const uuid = new ParseUUIDPipe({ version: "4" });
const stopSchema = z.object({ c: z.string().uuid(), t: z.string().regex(/^[0-9a-f]{64}$/) });

@RequirePermission("emails.manage")
@Controller({ path: "admin/outreach", version: "1" })
export class AdminOutreachController {
  constructor(
    private readonly contacts: OutreachContactsService,
    private readonly sender: OutreachSenderService,
  ) {}

  @Get("templates")
  templates() {
    return OUTREACH_TEMPLATES;
  }

  @Get("contacts")
  list(@Query(new ZodValidationPipe(outreachListSchema)) query: OutreachListQuery) {
    return this.contacts.list(query);
  }

  @Get("contacts/:id")
  detail(@Param("id", uuid) id: string) {
    return this.contacts.detail(id);
  }

  @Post("contacts")
  create(@Body(new ZodValidationPipe(outreachContactSchema)) input: OutreachContactInput, @CurrentPrincipal() principal: AuthPrincipal, @Meta() meta: RequestMeta) {
    return this.contacts.create(principal, input, meta);
  }

  @Post("contacts/import")
  import(@Body(new ZodValidationPipe(importOutreachSchema)) input: ImportOutreachInput, @CurrentPrincipal() principal: AuthPrincipal, @Meta() meta: RequestMeta) {
    return this.contacts.import(principal, input, meta);
  }

  @Patch("contacts/:id")
  update(
    @Param("id", uuid) id: string,
    @Body(new ZodValidationPipe(updateOutreachContactSchema)) input: UpdateOutreachContactInput,
    @CurrentPrincipal() principal: AuthPrincipal,
    @Meta() meta: RequestMeta,
  ) {
    return this.contacts.update(principal, id, input, meta);
  }

  @HttpCode(204)
  @Delete("contacts/:id")
  async remove(@Param("id", uuid) id: string, @CurrentPrincipal() principal: AuthPrincipal, @Meta() meta: RequestMeta): Promise<void> {
    await this.contacts.remove(principal, id, meta);
  }

  @Throttle(THROTTLE.authStrict)
  @HttpCode(200)
  @Post("send")
  send(@Body(new ZodValidationPipe(sendOutreachSchema)) input: SendOutreachInput, @CurrentPrincipal() principal: AuthPrincipal, @Meta() meta: RequestMeta) {
    return this.sender.send(principal, input, meta);
  }
}

@Controller({ path: "public/outreach", version: "1" })
export class PublicOutreachController {
  constructor(private readonly optOuts: OutreachOptOutsService) {}

  @Public()
  @Throttle(THROTTLE.auth)
  @HttpCode(204)
  @Post("stop")
  async stop(@Body(new ZodValidationPipe(stopSchema)) input: z.infer<typeof stopSchema>): Promise<void> {
    await this.optOuts.stop(input.c, input.t);
  }
}
