import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Inject, Param, ParseUUIDPipe, Post, Res } from "@nestjs/common";
import { Throttle } from "@nestjs/throttler";
import { type AcceptInvitationInput, acceptInvitationSchema, type AuthenticatedResult, type InviteMemberInput, inviteMemberSchema, invitationTokenSchema } from "../../../shared";
import type { Response } from "express";

import type { AuthPrincipal, RequestMeta } from "../../../common/auth/auth-principal";
import { CurrentPrincipal, Meta, Public, RequirePermission } from "../../../common/auth/decorators";
import { ZodValidationPipe } from "../../../common/http/zod-validation.pipe";
import { APP_CONFIG } from "../../../config/config.module";
import type { AppConfig } from "../../../config/config.schema";
import { THROTTLE } from "../../../infrastructure/rate-limit/rate-limit.module";
import { setRefreshCookie } from "../../auth/tokens/refresh-cookie";
import { InvitationsService } from "./invitations.service";
import { TeamService } from "./team.service";

const uuid = new ParseUUIDPipe({ version: "4" });

@Controller({ path: "vendor/team", version: "1" })
export class TeamController {
  constructor(private readonly team: TeamService) {}

  @RequirePermission("vendor.team.read")
  @Get()
  view(@CurrentPrincipal() principal: AuthPrincipal) {
    return this.team.view(principal);
  }

  @RequirePermission("vendor.team.manage")
  @Throttle(THROTTLE.authStrict)
  @Post("invitations")
  @HttpCode(HttpStatus.ACCEPTED)
  async invite(@Body(new ZodValidationPipe(inviteMemberSchema)) input: InviteMemberInput, @CurrentPrincipal() principal: AuthPrincipal, @Meta() meta: RequestMeta) {
    await this.team.invite(principal, input.email, meta);
    return { status: "INVITED" };
  }

  @RequirePermission("vendor.team.manage")
  @Delete("invitations/:id")
  @HttpCode(HttpStatus.NO_CONTENT)
  revoke(@Param("id", uuid) id: string, @CurrentPrincipal() principal: AuthPrincipal, @Meta() meta: RequestMeta) {
    return this.team.revokeInvitation(principal, id, meta);
  }

  @RequirePermission("vendor.team.manage")
  @Delete("members/:userId")
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(@Param("userId", uuid) userId: string, @CurrentPrincipal() principal: AuthPrincipal, @Meta() meta: RequestMeta) {
    return this.team.removeMember(principal, userId, meta);
  }
}

@Controller({ path: "invitations", version: "1" })
export class InvitationsController {
  constructor(
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    private readonly invitations: InvitationsService,
  ) {}

  @Public()
  @Throttle(THROTTLE.auth)
  @Post("preview")
  @HttpCode(HttpStatus.OK)
  preview(@Body(new ZodValidationPipe(invitationTokenSchema)) input: { token: string }) {
    return this.invitations.preview(input.token);
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
    const issued = await this.invitations.accept(input, meta);
    setRefreshCookie(response, issued.refreshToken, this.config);
    return issued.result;
  }
}
