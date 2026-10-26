import type { CookieOptions, Request, Response } from "express";

import type { AppConfig } from "../../../config/config.schema";

export const REFRESH_COOKIE = "gfn_rt";
const COOKIE_PATH = "/v1/auth";

function options(config: AppConfig): CookieOptions {
  return { httpOnly: true, secure: config.NODE_ENV === "production" || config.API_PUBLIC_URL.startsWith("https://"), sameSite: "strict", path: COOKIE_PATH, domain: config.COOKIE_DOMAIN || undefined };
}

export function setRefreshCookie(response: Response, value: string, config: AppConfig): void {
  response.cookie(REFRESH_COOKIE, value, { ...options(config), maxAge: config.REFRESH_TTL_DAYS * 24 * 60 * 60 * 1000 });
}

export function clearRefreshCookie(response: Response, config: AppConfig): void {
  response.clearCookie(REFRESH_COOKIE, options(config));
}

export function readRefreshCookie(request: Request): string | null {
  const cookies = request.cookies as Record<string, unknown> | undefined;
  const value = cookies?.[REFRESH_COOKIE];
  return typeof value === "string" && value.length <= 200 ? value : null;
}
