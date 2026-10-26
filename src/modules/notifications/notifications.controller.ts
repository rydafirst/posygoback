import { Controller, Get, HttpCode, HttpStatus, Param, ParseUUIDPipe, Post } from "@nestjs/common";

import type { AuthPrincipal } from "../../common/auth/auth-principal";
import { CurrentPrincipal } from "../../common/auth/decorators";
import { NotificationsService } from "./notifications.service";

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
