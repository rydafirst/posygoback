import type { CookieOptions, Request, Response } from "express";

import type { AppConfig } from "../../../config/config.schema";

export const BUYER_COOKIE = "gfn_bs";
export const BUYER_SESSION_DAYS = 30;
const COOKIE_PATH = "/v1/buyer";

function options(config: AppConfig): CookieOptions {
  return { httpOnly: true, secure: config.NODE_ENV === "production" || config.API_PUBLIC_URL.startsWith("https://"), sameSite: "strict", path: COOKIE_PATH, domain: config.COOKIE_DOMAIN || undefined };
}

export function setBuyerCookie(response: Response, value: string, config: AppConfig): void {
  response.cookie(BUYER_COOKIE, value, { ...options(config), maxAge: BUYER_SESSION_DAYS * 24 * 60 * 60 * 1000 });
}

export function clearBuyerCookie(response: Response, config: AppConfig): void {
  response.clearCookie(BUYER_COOKIE, options(config));
}

export function readBuyerCookie(request: Request): string | null {
  const cookies = request.cookies as Record<string, unknown> | undefined;
  const value = cookies?.[BUYER_COOKIE];
  return typeof value === "string" && /^[A-Za-z0-9_-]{43}$/.test(value) ? value : null;
}
