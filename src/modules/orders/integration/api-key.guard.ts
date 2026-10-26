import { type CanActivate, createParamDecorator, type ExecutionContext, Injectable } from "@nestjs/common";
import type { Request } from "express";

import { Errors } from "../../../common/http/app-exception";
import { type ApiClient, ApiKeysService } from "./api-keys.service";

type ApiRequest = Request & { apiClient?: ApiClient };

function presentedKey(request: Request): string | undefined {
  const header = request.headers["x-api-key"];
  if (typeof header === "string") {
    return header;
  }
  const authorization = request.headers.authorization;
  return authorization?.startsWith("Bearer gfn_") ? authorization.slice("Bearer ".length) : undefined;
}

@Injectable()
export class ApiKeyGuard implements CanActivate {
  constructor(private readonly keys: ApiKeysService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<ApiRequest>();
    const client = await this.keys.authenticate(presentedKey(request));
    if (!client) {
      throw Errors.unauthenticated("Send a valid API key in the X-Api-Key header.");
    }
    request.apiClient = client;
    return true;
  }
}

export const CurrentApiClient = createParamDecorator((_data: unknown, context: ExecutionContext): ApiClient => {
  const client = context.switchToHttp().getRequest<ApiRequest>().apiClient;
  if (!client) {
    throw Errors.unauthenticated();
  }
  return client;
});
