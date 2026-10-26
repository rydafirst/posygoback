import { type CanActivate, type ExecutionContext, Injectable } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { hasPermission, PARTNER_OPERATIONS, type Permission } from "../../shared";
import type { Request } from "express";

import { PrismaService } from "../../database/prisma.service";
import { AccessTokenService } from "../../modules/auth/tokens/access-token.service";
import { SessionService } from "../../modules/auth/sessions/session.service";
import { Errors } from "../http/app-exception";
import { ALLOW_PENDING_MFA, PUBLIC_ROUTE, REQUIRED_PERMISSION } from "./decorators";

const BEARER = /^Bearer ([A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+)$/;

@Injectable()
export class AccessGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly tokens: AccessTokenService,
    private readonly sessions: SessionService,
    private readonly prisma: PrismaService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const targets = [context.getHandler(), context.getClass()];
    if (this.reflector.getAllAndOverride<boolean>(PUBLIC_ROUTE, targets)) {
      return true;
    }
    const request = context.switchToHttp().getRequest<Request>();
    const token = BEARER.exec(request.header("authorization") ?? "")?.[1];
    const principal = token ? await this.tokens.verify(token) : null;
    if (!principal) {
      throw Errors.unauthenticated();
    }
    await this.sessions.assertActive(principal.sessionId, principal.userId);
    request.principal = principal;

    if (principal.mfaState === "ENROLMENT_REQUIRED" && !this.reflector.getAllAndOverride<boolean>(ALLOW_PENDING_MFA, targets)) {
      throw Errors.mfaEnrolmentRequired();
    }
    const permission = this.reflector.getAllAndOverride<Permission | undefined>(REQUIRED_PERMISSION, targets);
    if (permission && !hasPermission(principal.role, permission)) {
      throw Errors.notFound();
    }
    if (principal.partnerId && permission && PARTNER_OPERATIONS.includes(permission) && !(await this.partnerOperating(principal.partnerId))) {
      throw Errors.forbidden("Warehouse work opens once your partnership is active.");
    }
    return true;
  }

  private async partnerOperating(partnerId: string): Promise<boolean> {
    const partner = await this.prisma.fulfilmentPartner.findUnique({ where: { id: partnerId }, select: { status: true } });
    return partner?.status === "ACTIVE";
  }
}
