import { type CanActivate, createParamDecorator, type ExecutionContext, Injectable } from "@nestjs/common";
import type { Request } from "express";

import { Errors } from "../../../common/http/app-exception";
import { BuyerAuthService } from "./buyer-auth.service";
import { readBuyerCookie } from "./buyer-cookie";

@Injectable()
export class BuyerSessionGuard implements CanActivate {
  constructor(private readonly auth: BuyerAuthService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<Request>();
    const token = readBuyerCookie(request);
    const buyerId = token ? await this.auth.resolve(token) : null;
    if (!buyerId) {
      throw Errors.unauthenticated();
    }
    request.buyerId = buyerId;
    return true;
  }
}

export const CurrentBuyer = createParamDecorator((_data: unknown, context: ExecutionContext): string => {
  const buyerId = context.switchToHttp().getRequest<Request>().buyerId;
  if (!buyerId) {
    throw Errors.unauthenticated();
  }
  return buyerId;
});
