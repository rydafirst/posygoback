import { type CanActivate, type ExecutionContext, Inject, Injectable } from "@nestjs/common";
import type { Request } from "express";

import { APP_CONFIG } from "../../config/config.module";
import type { AppConfig } from "../../config/config.schema";
import { Errors } from "../http/app-exception";

@Injectable()
export class TrustedOriginGuard implements CanActivate {
  private readonly allowed: string;

  constructor(@Inject(APP_CONFIG) config: AppConfig) {
    this.allowed = new URL(config.WEB_PUBLIC_URL).origin;
  }

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<Request>();
    if (request.header("origin") !== this.allowed) {
      throw Errors.originRejected();
    }
    return true;
  }
}
