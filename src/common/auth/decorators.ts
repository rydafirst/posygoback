import { createParamDecorator, type ExecutionContext, SetMetadata } from "@nestjs/common";
import type { Permission } from "../../shared";
import type { Request } from "express";

import { Errors } from "../http/app-exception";
import type { AuthPrincipal, RequestMeta } from "./auth-principal";

export const PUBLIC_ROUTE = "gfn:public";
export const ALLOW_PENDING_MFA = "gfn:allow-pending-mfa";
export const REQUIRED_PERMISSION = "gfn:required-permission";

export const Public = () => SetMetadata(PUBLIC_ROUTE, true);

export const AllowPendingMfa = () => SetMetadata(ALLOW_PENDING_MFA, true);

export const RequirePermission = (permission: Permission) => SetMetadata(REQUIRED_PERMISSION, permission);

export const CurrentPrincipal = createParamDecorator((_data: unknown, context: ExecutionContext): AuthPrincipal => {
  const principal = context.switchToHttp().getRequest<Request>().principal;
  if (!principal) {
    throw Errors.unauthenticated();
  }
  return principal;
});

export const Meta = createParamDecorator((_data: unknown, context: ExecutionContext): RequestMeta => {
  const request = context.switchToHttp().getRequest<Request>();
  return { ip: request.clientIp, userAgent: request.header("user-agent")?.slice(0, 512) ?? null, correlationId: request.correlationId };
});
