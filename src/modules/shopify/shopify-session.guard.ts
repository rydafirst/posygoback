import { type CanActivate, createParamDecorator, type ExecutionContext, Injectable } from "@nestjs/common";
import type { Request } from "express";

import { Errors } from "../../common/http/app-exception";
import { ShopifyAdminClient } from "./shopify-admin.client";
import { verifySessionToken } from "./shopify-session-token";

const BEARER = /^Bearer (\S+)$/;

interface ShopifySession {
  shopDomain: string;
  sessionToken: string;
}

type ShopifyRequest = Request & { shopifySession?: ShopifySession };

@Injectable()
export class ShopifySessionGuard implements CanActivate {
  constructor(private readonly shopify: ShopifyAdminClient) {}

  canActivate(context: ExecutionContext): boolean {
    if (!this.shopify.configured) {
      throw Errors.notFound("The Shopify app isn't switched on yet.");
    }
    const request = context.switchToHttp().getRequest<ShopifyRequest>();
    const sessionToken = BEARER.exec(request.header("authorization") ?? "")?.[1];
    const shopDomain = sessionToken ? verifySessionToken(sessionToken, this.shopify.apiKey, this.shopify.secret) : null;
    if (!sessionToken || !shopDomain) {
      throw Errors.unauthenticated("Open Posygo from your Shopify admin.");
    }
    request.shopifySession = { shopDomain, sessionToken };
    return true;
  }
}

export const CurrentShopifySession = createParamDecorator((_data: unknown, context: ExecutionContext): ShopifySession => {
  const session = context.switchToHttp().getRequest<ShopifyRequest>().shopifySession;
  if (!session) {
    throw Errors.unauthenticated();
  }
  return session;
});
