import { Body, Controller, Get, HttpCode, Param, Patch, Post } from "@nestjs/common";
import { Throttle } from "@nestjs/throttler";
import { z } from "zod";

import type { AuthPrincipal, RequestMeta } from "../../common/auth/auth-principal";
import { CurrentPrincipal, Meta, Public, RequirePermission } from "../../common/auth/decorators";
import { ZodValidationPipe } from "../../common/http/zod-validation.pipe";
import { THROTTLE } from "../../infrastructure/rate-limit/rate-limit.module";
import { type ReminderKey, reminderKeySchema, type ReminderTemplateInput, reminderTemplateSchema, type UpdateReminderInput, updateReminderSchema } from "../../shared";
import { ReminderOptOutsService } from "./reminder-opt-outs.service";
import { ReminderSettingsService } from "./reminder-settings.service";

const keyPipe = new ZodValidationPipe(reminderKeySchema);
const stopSchema = z.object({ e: z.string().min(4).max(400).regex(/^[A-Za-z0-9_-]+$/), t: z.string().regex(/^[0-9a-f]{64}$/) });

@RequirePermission("emails.manage")
@Controller({ path: "admin/reminders", version: "1" })
export class AdminRemindersController {
  constructor(private readonly settings: ReminderSettingsService) {}

  @Get()
  list() {
    return this.settings.list();
  }

  @Patch(":key")
  update(@Param("key", keyPipe) key: ReminderKey, @Body(new ZodValidationPipe(updateReminderSchema)) input: UpdateReminderInput, @CurrentPrincipal() principal: AuthPrincipal, @Meta() meta: RequestMeta) {
    return this.settings.update(principal, key, input, meta);
  }

  @Post(":key/reset")
  reset(@Param("key", keyPipe) key: ReminderKey, @CurrentPrincipal() principal: AuthPrincipal, @Meta() meta: RequestMeta) {
    return this.settings.reset(principal, key, meta);
  }

  @HttpCode(200)
  @Post(":key/preview")
  preview(@Param("key", keyPipe) key: ReminderKey, @Body(new ZodValidationPipe(reminderTemplateSchema)) template: ReminderTemplateInput) {
    return this.settings.preview(key, template);
  }

  @Throttle(THROTTLE.authStrict)
  @HttpCode(200)
  @Post(":key/test")
  test(@Param("key", keyPipe) key: ReminderKey, @Body(new ZodValidationPipe(reminderTemplateSchema)) template: ReminderTemplateInput, @CurrentPrincipal() principal: AuthPrincipal) {
    return this.settings.sendTest(principal, key, template);
  }
}

@Controller({ path: "public/reminders", version: "1" })
export class PublicRemindersController {
  constructor(private readonly optOuts: ReminderOptOutsService) {}

  @Public()
  @Throttle(THROTTLE.auth)
  @HttpCode(204)
  @Post("stop")
  async stop(@Body(new ZodValidationPipe(stopSchema)) input: z.infer<typeof stopSchema>): Promise<void> {
    await this.optOuts.stop(input.e, input.t);
  }
}
