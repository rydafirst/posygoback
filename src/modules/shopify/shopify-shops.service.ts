import { Inject, Injectable } from "@nestjs/common";

import { Errors } from "../../common/http/app-exception";
import { APP_CONFIG } from "../../config/config.module";
import type { AppConfig } from "../../config/config.schema";
import { PrismaService } from "../../database/prisma.service";
import type { ShopifyShop } from "../../generated/prisma/client";
import { FieldEncryptionService } from "../../infrastructure/crypto/field-encryption.service";
import type { IntegrationAccountView, ShopifyConnectInput, ShopifyShopView } from "../../shared";
import { type ApiClient, ApiKeysService } from "../orders/integration/api-keys.service";
import { IntegrationCatalogService } from "../orders/integration/integration-catalog.service";
import { ShopifyAdminClient, ShopifyApiError, type ShopifyUserError, userErrorMessage } from "./shopify-admin.client";
import { CREATE_FULFILMENT_SERVICE, DELETE_FULFILMENT_SERVICE, FULFILMENT_SERVICES } from "./shopify-queries";

export const SHOPIFY_SERVICE_NAME = "Posygo";
const SERVICE_NAMES = [SHOPIFY_SERVICE_NAME, "Posygo Fulfilment", "Posygo Hub"];
const NAME_TAKEN = /already been taken/i;
const RECENT_REQUESTS = 10;

export interface LinkedShop {
  shop: ShopifyShop;
  accessToken: string;
  client: ApiClient;
}

interface CreatedService {
  fulfillmentServiceCreate: { fulfillmentService: { id: string; location: { id: string; name: string } | null } | null; userErrors: ShopifyUserError[] };
}

interface ExistingServices {
  shop: { fulfillmentServices: Array<{ id: string; callbackUrl: string | null; location: { id: string } | null }> };
}

interface DeletedService {
  fulfillmentServiceDelete: { userErrors: ShopifyUserError[] };
}

export function tokenContext(shopDomain: string): string {
  return `shopify_shops.access_token:${shopDomain}`;
}

@Injectable()
export class ShopifyShopsService {
  constructor(
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    private readonly prisma: PrismaService,
    private readonly encryption: FieldEncryptionService,
    private readonly shopify: ShopifyAdminClient,
    private readonly keys: ApiKeysService,
    private readonly catalog: IntegrationCatalogService,
  ) {}

  async open(shopDomain: string, sessionToken: string): Promise<ShopifyShopView> {
    const existing = await this.prisma.shopifyShop.findUnique({ where: { shopDomain } });
    if (!existing?.accessTokenEncrypted || existing.uninstalledAt) {
      const token = await this.exchange(shopDomain, sessionToken);
      await this.prisma.shopifyShop.upsert({
        where: { shopDomain },
        create: { shopDomain, accessTokenEncrypted: this.encryption.encrypt(token.accessToken, tokenContext(shopDomain)), scopes: token.scope },
        update: {
          accessTokenEncrypted: this.encryption.encrypt(token.accessToken, tokenContext(shopDomain)),
          scopes: token.scope,
          uninstalledAt: null,
          installedAt: existing?.uninstalledAt ? new Date() : undefined,
        },
      });
    }
    return this.view(shopDomain);
  }

  async preview(apiKey: string): Promise<IntegrationAccountView> {
    return this.catalog.account(await this.authenticate(apiKey));
  }

  async connect(shopDomain: string, input: ShopifyConnectInput): Promise<ShopifyShopView> {
    const client = await this.authenticate(input.apiKey);
    const account = await this.catalog.account(client);
    if (!account.countries.includes(input.country)) {
      throw Errors.validation({ country: ["Your Posygo account doesn't store stock in this country yet"] });
    }
    const shop = await this.installed(shopDomain);
    const accessToken = this.accessToken(shop);
    const service = shop.fulfillmentServiceId && shop.locationId ? { id: shop.fulfillmentServiceId, locationId: shop.locationId } : await this.ensureService(shop.shopDomain, accessToken);
    await this.prisma.shopifyShop.update({
      where: { id: shop.id },
      data: { vendorId: client.vendorId, apiKeyId: client.apiKeyId, country: input.country, fulfillmentServiceId: service.id, locationId: service.locationId },
    });
    return this.view(shopDomain);
  }

  async disconnect(shopDomain: string): Promise<ShopifyShopView> {
    const shop = await this.installed(shopDomain);
    if (shop.fulfillmentServiceId) {
      const result = await this.call<DeletedService>(shop.shopDomain, this.accessToken(shop), DELETE_FULFILMENT_SERVICE, { id: shop.fulfillmentServiceId });
      const problem = userErrorMessage(result.fulfillmentServiceDelete.userErrors);
      if (problem) {
        throw Errors.invalidTransition(`Shopify couldn't remove the Posygo location: ${problem}`);
      }
    }
    await this.prisma.shopifyShop.update({ where: { id: shop.id }, data: { vendorId: null, apiKeyId: null, country: null, fulfillmentServiceId: null, locationId: null } });
    return this.view(shopDomain);
  }

  async linked(shopDomain: string): Promise<LinkedShop | null> {
    const shop = await this.prisma.shopifyShop.findUnique({ where: { shopDomain }, include: { apiKey: true } });
    if (!shop?.accessTokenEncrypted || shop.uninstalledAt || !shop.vendorId || !shop.apiKey || shop.apiKey.revokedAt || !shop.country) {
      return null;
    }
    return { shop, accessToken: this.accessToken(shop), client: { keyId: shop.apiKey.keyId, apiKeyId: shop.apiKey.id, vendorId: shop.vendorId } };
  }

  accessToken(shop: ShopifyShop): string {
    if (!shop.accessTokenEncrypted) {
      throw Errors.invalidTransition("Open the Posygo app in Shopify again to reconnect it.");
    }
    return this.encryption.decrypt(shop.accessTokenEncrypted, tokenContext(shop.shopDomain));
  }

  private async view(shopDomain: string): Promise<ShopifyShopView> {
    const shop = await this.prisma.shopifyShop.findUniqueOrThrow({
      where: { shopDomain },
      include: {
        vendor: { select: { businessName: true } },
        apiKey: { select: { revokedAt: true } },
        requests: { orderBy: { createdAt: "desc" }, take: RECENT_REQUESTS, include: { order: { select: { reference: true } } } },
      },
    });
    return {
      shopDomain,
      connected: Boolean(shop.vendorId && shop.apiKey && !shop.apiKey.revokedAt && shop.locationId),
      businessName: shop.vendor?.businessName ?? null,
      country: shop.country,
      locationName: shop.locationId ? SHOPIFY_SERVICE_NAME : null,
      recent: shop.requests.map((request) => ({
        orderName: request.orderName,
        outcome: request.outcome,
        message: request.message,
        orderReference: request.order?.reference ?? null,
        createdAt: request.createdAt.toISOString(),
      })),
    };
  }

  private async authenticate(apiKey: string): Promise<ApiClient> {
    const client = await this.keys.authenticate(apiKey);
    if (!client) {
      throw Errors.validation({ apiKey: ["This API key isn't valid. Create one in Posygo under Integrations."] });
    }
    return client;
  }

  private async installed(shopDomain: string): Promise<ShopifyShop> {
    const shop = await this.prisma.shopifyShop.findUnique({ where: { shopDomain } });
    if (!shop || shop.uninstalledAt) {
      throw Errors.notFound("Open the Posygo app from your Shopify admin first.");
    }
    return shop;
  }

  private async ensureService(shopDomain: string, accessToken: string): Promise<{ id: string; locationId: string }> {
    const callbackUrl = `${this.config.API_PUBLIC_URL.replace(/\/$/, "")}/v1/shopify/fulfilment`;
    const existing = await this.call<ExistingServices>(shopDomain, accessToken, FULFILMENT_SERVICES, {});
    const ours = existing.shop.fulfillmentServices.find((service) => service.callbackUrl === callbackUrl && service.location);
    if (ours?.location) {
      return { id: ours.id, locationId: ours.location.id };
    }
    let problem = "no location was created";
    for (const name of SERVICE_NAMES) {
      const created = (await this.call<CreatedService>(shopDomain, accessToken, CREATE_FULFILMENT_SERVICE, { name, callbackUrl })).fulfillmentServiceCreate;
      if (created.fulfillmentService?.location) {
        return { id: created.fulfillmentService.id, locationId: created.fulfillmentService.location.id };
      }
      problem = userErrorMessage(created.userErrors) ?? problem;
      if (!NAME_TAKEN.test(problem)) {
        break;
      }
    }
    throw Errors.invalidTransition(`Shopify couldn't add the Posygo location: ${problem}`);
  }

  private async exchange(shopDomain: string, sessionToken: string) {
    try {
      return await this.shopify.exchangeSessionToken(shopDomain, sessionToken);
    } catch (error) {
      throw this.translate(error);
    }
  }

  private async call<T>(shopDomain: string, accessToken: string, query: string, variables: Record<string, unknown>): Promise<T> {
    try {
      return await this.shopify.graphql<T>(shopDomain, accessToken, query, variables);
    } catch (error) {
      if (error instanceof ShopifyApiError && error.unauthorised) {
        await this.prisma.shopifyShop.update({ where: { shopDomain }, data: { accessTokenEncrypted: null } });
      }
      throw this.translate(error);
    }
  }

  private translate(error: unknown): Error {
    if (error instanceof ShopifyApiError) {
      return error.unauthorised ? Errors.invalidTransition("Shopify asked us to sign in again. Reload the app and try once more.") : Errors.invalidTransition(`${error.message} Try again in a minute.`);
    }
    return error instanceof Error ? error : new Error(String(error));
  }
}
