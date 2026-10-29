import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Inject, Param, ParseUUIDPipe, Post, Put, Res } from "@nestjs/common";
import { Throttle } from "@nestjs/throttler";
import { type AcceptInvitationInput, acceptInvitationSchema, type AuthenticatedResult, type ChangeStaffRoleInput, changeStaffRoleSchema, invitationTokenSchema, type InviteStaffInput, inviteStaffSchema } from "../../shared";
import type { Response } from "express";

import type { AuthPrincipal, RequestMeta } from "../../common/auth/auth-principal";
import { CurrentPrincipal, Meta, Public, RequirePermission } from "../../common/auth/decorators";
import { ZodValidationPipe } from "../../common/http/zod-validation.pipe";
import { APP_CONFIG } from "../../config/config.module";
import type { AppConfig } from "../../config/config.schema";
import { THROTTLE } from "../../infrastructure/rate-limit/rate-limit.module";
import { setRefreshCookie } from "../auth/tokens/refresh-cookie";
import { StaffService } from "./staff.service";

const uuid = new ParseUUIDPipe({ version: "4" });

@Controller({ path: "admin/staff", version: "1" })
export class AdminStaffController {
  constructor(private readonly staff: StaffService) {}

  @RequirePermission("staff.manage")
  @Get()
  directory() {
    return this.staff.directory();
  }

  @RequirePermission("staff.manage")
  @Throttle(THROTTLE.authStrict)
  @Post("invitations")
  @HttpCode(HttpStatus.ACCEPTED)
  async invite(@Body(new ZodValidationPipe(inviteStaffSchema)) input: InviteStaffInput, @CurrentPrincipal() principal: AuthPrincipal, @Meta() meta: RequestMeta) {
    await this.staff.invite(principal, input, meta);
    return { status: "INVITED" };
  }

  @RequirePermission("staff.manage")
  @Delete("invitations/:id")
  @HttpCode(HttpStatus.NO_CONTENT)
  revoke(@Param("id", uuid) id: string, @CurrentPrincipal() principal: AuthPrincipal, @Meta() meta: RequestMeta) {
    return this.staff.revoke(principal, id, meta);
  }

  @RequirePermission("staff.manage")
  @Post("members/:userId/suspend")
  @HttpCode(HttpStatus.NO_CONTENT)
  suspend(@Param("userId", uuid) userId: string, @CurrentPrincipal() principal: AuthPrincipal, @Meta() meta: RequestMeta) {
    return this.staff.suspend(principal, userId, meta);
  }

  @RequirePermission("staff.manage")
  @Put("members/:userId/role")
  @HttpCode(HttpStatus.NO_CONTENT)
  changeRole(
    @Param("userId", uuid) userId: string,
    @Body(new ZodValidationPipe(changeStaffRoleSchema)) input: ChangeStaffRoleInput,
    @CurrentPrincipal() principal: AuthPrincipal,
    @Meta() meta: RequestMeta,
  ) {
    return this.staff.changeRole(principal, userId, input, meta);
  }
}

@Controller({ path: "staff-invitations", version: "1" })
export class StaffInvitationsController {
  constructor(
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    private readonly staff: StaffService,
  ) {}

  @Public()
  @Throttle(THROTTLE.auth)
  @Post("preview")
  @HttpCode(HttpStatus.OK)
  preview(@Body(new ZodValidationPipe(invitationTokenSchema)) input: { token: string }) {
    return this.staff.preview(input.token);
  }

  @Public()
  @Throttle(THROTTLE.authStrict)
  @Post("accept")
  @HttpCode(HttpStatus.OK)
  async accept(
    @Body(new ZodValidationPipe(acceptInvitationSchema)) input: AcceptInvitationInput,
    @Meta() meta: RequestMeta,
    @Res({ passthrough: true }) response: Response,
  ): Promise<AuthenticatedResult> {
    const issued = await this.staff.accept(input, meta);
    setRefreshCookie(response, issued.refreshToken, this.config);
    return issued.result;
  }
}
