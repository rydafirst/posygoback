import { Inject, Injectable } from "@nestjs/common";

import { APP_CONFIG } from "../../config/config.module";
import type { AppConfig } from "../../config/config.schema";

const REQUEST_TIMEOUT_MS = 15_000;

export class ShopifyApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "ShopifyApiError";
  }

  get unauthorised(): boolean {
    return this.status === 401 || this.status === 403;
  }
}

export interface ShopifyUserError {
  field?: string[] | null;
  message: string;
}

export interface OfflineToken {
  accessToken: string;
  scope: string;
}

@Injectable()
export class ShopifyAdminClient {
  constructor(@Inject(APP_CONFIG) private readonly config: AppConfig) {}

  get configured(): boolean {
    return Boolean(this.config.SHOPIFY_API_KEY && this.config.SHOPIFY_API_SECRET);
  }

  get apiKey(): string {
    return this.config.SHOPIFY_API_KEY;
  }

  get secret(): string {
    return this.config.SHOPIFY_API_SECRET;
  }

  async exchangeSessionToken(shop: string, sessionToken: string): Promise<OfflineToken> {
    const body = await this.post<{ access_token?: string; scope?: string }>(`https://${shop}/admin/oauth/access_token`, {
      client_id: this.config.SHOPIFY_API_KEY,
      client_secret: this.config.SHOPIFY_API_SECRET,
      grant_type: "urn:ietf:params:oauth:grant-type:token-exchange",
      subject_token: sessionToken,
      subject_token_type: "urn:ietf:params:oauth:token-type:id_token",
      requested_token_type: "urn:shopify:params:oauth:token-type:offline-access-token",
    });
    if (!body.access_token) {
      throw new ShopifyApiError(502, "Shopify didn't return an access token.");
    }
    return { accessToken: body.access_token, scope: body.scope ?? "" };
  }

  async graphql<T>(shop: string, accessToken: string, query: string, variables: Record<string, unknown> = {}): Promise<T> {
    const body = await this.post<{ data?: T; errors?: Array<{ message: string }> }>(
      `https://${shop}/admin/api/${this.config.SHOPIFY_API_VERSION}/graphql.json`,
      { query, variables },
      { "X-Shopify-Access-Token": accessToken },
    );
    if (body.errors?.length || !body.data) {
      throw new ShopifyApiError(502, body.errors?.map((error) => error.message).join(" ") || "Shopify returned no data.");
    }
    return body.data;
  }

  private async post<T>(url: string, payload: unknown, headers: Record<string, string> = {}): Promise<T> {
    let response: Response;
    try {
      response = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json", ...headers },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
    } catch {
      throw new ShopifyApiError(0, "Couldn't reach Shopify.");
    }
    if (!response.ok) {
      throw new ShopifyApiError(response.status, `Shopify answered ${response.status}.`);
    }
    return (await response.json()) as T;
  }
}

export function userErrorMessage(errors: ShopifyUserError[] | undefined): string | null {
  return errors?.length ? errors.map((error) => error.message).join(" ") : null;
}
