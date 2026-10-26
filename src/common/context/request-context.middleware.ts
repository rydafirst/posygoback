import { randomUUID } from "node:crypto";

import { Inject, Injectable, type NestMiddleware } from "@nestjs/common";
import type { NextFunction, Request, Response } from "express";

import { APP_CONFIG } from "../../config/config.module";
import type { AppConfig } from "../../config/config.schema";

const CORRELATION_PATTERN = /^[A-Za-z0-9-]{8,64}$/;

@Injectable()
export class RequestContextMiddleware implements NestMiddleware {
  constructor(@Inject(APP_CONFIG) private readonly config: AppConfig) {}

  use(request: Request, response: Response, next: NextFunction): void {
    const incoming = request.header("x-correlation-id");
    request.correlationId = incoming && CORRELATION_PATTERN.test(incoming) ? incoming : randomUUID();
    request.clientIp = this.resolveClientIp(request);
    response.setHeader("x-correlation-id", request.correlationId);
    next();
  }

  private resolveClientIp(request: Request): string {
    const header = this.config.CLIENT_IP_HEADER;
    if (header) {
      const value = request.header(header)?.split(",")[0]?.trim();
      if (value && value.length <= 64) {
        return value;
      }
    }
    return request.ip ?? "unknown";
  }
}
