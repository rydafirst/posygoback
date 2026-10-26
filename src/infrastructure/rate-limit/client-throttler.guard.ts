import { Injectable } from "@nestjs/common";
import { ThrottlerGuard } from "@nestjs/throttler";
import type { Request } from "express";

const API_KEY_ID = /^gfn_(?:live|test)_([0-9a-f]{16})\./;

function apiKeyId(request: Request): string | null {
  const header = request.headers["x-api-key"];
  const authorization = request.headers.authorization;
  const presented = typeof header === "string" ? header : authorization?.startsWith("Bearer gfn_") ? authorization.slice("Bearer ".length) : "";
  return API_KEY_ID.exec(presented)?.[1] ?? null;
}

@Injectable()
export class ClientThrottlerGuard extends ThrottlerGuard {
  protected override getTracker(request: Record<string, unknown>): Promise<string> {
    const typed = request as unknown as Request;
    const apiKey = apiKeyId(typed);
    const subject = typed.principal ? `user:${typed.principal.userId}` : apiKey ? `api-key:${apiKey}` : `ip:${typed.clientIp}`;
    return Promise.resolve(subject);
  }
}
