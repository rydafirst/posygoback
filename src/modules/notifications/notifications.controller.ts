import { Body, Controller, Get, HttpCode, HttpStatus, Param, ParseUUIDPipe, Post, Put } from "@nestjs/common";

import type { AuthPrincipal } from "../../common/auth/auth-principal";
import type { RequestMeta } from "../../common/auth/auth-principal";
import { CurrentPrincipal, Meta, RequirePermission } from "../../common/auth/decorators";
import { ZodValidationPipe } from "../../common/http/zod-validation.pipe";
import { type EmailAlertSettingInput, emailAlertSettingSchema } from "../../shared";
import { NotificationsService } from "./notifications.service";
import { StaffEmailSettingsService } from "./staff-email-settings.service";

@Controller({ path: "notifications", version: "1" })
export class NotificationsController {
  constructor(private readonly notifications: NotificationsService) {}

  @Get()
  feed(@CurrentPrincipal() principal: AuthPrincipal) {
    return this.notifications.feed(principal);
  }

  @Post("read-all")
  @HttpCode(HttpStatus.OK)
  readAll(@CurrentPrincipal() principal: AuthPrincipal) {
    return this.notifications.markAllRead(principal);
  }

  @Post(":id/read")
  @HttpCode(HttpStatus.OK)
  read(@CurrentPrincipal() principal: AuthPrincipal, @Param("id", new ParseUUIDPipe({ version: "4" })) id: string) {
    return this.notifications.markRead(principal, id);
  }
}

@Controller({ path: "admin/email-alerts", version: "1" })
export class AdminEmailAlertsController {
  constructor(private readonly settings: StaffEmailSettingsService) {}

  @RequirePermission("staff.manage")
  @Get()
  list() {
    return this.settings.list();
  }

  @RequirePermission("staff.manage")
  @Put(":topic")
  change(
    @Param("topic") topic: string,
    @Body(new ZodValidationPipe(emailAlertSettingSchema)) input: EmailAlertSettingInput,
    @CurrentPrincipal() principal: AuthPrincipal,
    @Meta() meta: RequestMeta,
  ) {
    return this.settings.set(topic, input.enabled, { userId: principal.userId, role: principal.role }, meta);
  }
}
