import { Injectable, Logger } from "@nestjs/common";

import { PrismaService } from "../../database/prisma.service";

export const SHOPIFY_WEBHOOK_TOPICS = ["app/uninstalled", "app/scopes_update", "customers/data_request", "customers/redact", "shop/redact"] as const;
export type ShopifyWebhookTopic = (typeof SHOPIFY_WEBHOOK_TOPICS)[number];

export function isShopifyWebhookTopic(value: unknown): value is ShopifyWebhookTopic {
  return typeof value === "string" && (SHOPIFY_WEBHOOK_TOPICS as readonly string[]).includes(value);
}

@Injectable()
export class ShopifyWebhooksService {
  private readonly logger = new Logger(ShopifyWebhooksService.name);

  constructor(private readonly prisma: PrismaService) {}

  async handle(shopDomain: string, topic: ShopifyWebhookTopic, payload: unknown): Promise<void> {
    switch (topic) {
      case "app/uninstalled":
        await this.prisma.shopifyShop.updateMany({
          where: { shopDomain },
          data: { uninstalledAt: new Date(), accessTokenEncrypted: null, fulfillmentServiceId: null, locationId: null },
        });
        return;
      case "app/scopes_update":
        await this.prisma.shopifyShop.updateMany({ where: { shopDomain }, data: { scopes: scopesOf(payload) } });
        return;
      case "shop/redact":
        await this.prisma.shopifyShop.deleteMany({ where: { shopDomain } });
        return;
      case "customers/data_request":
      case "customers/redact":
        this.logger.log(`Shopify ${topic} received for ${shopDomain}. Posygo keeps no Shopify customer records beyond the vendor's own orders.`);
        return;
    }
  }
}

function scopesOf(payload: unknown): string {
  const current = (payload as { current?: unknown })?.current;
  return Array.isArray(current) ? current.filter((scope) => typeof scope === "string").join(",").slice(0, 500) : "";
}
