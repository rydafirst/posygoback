import { Module } from "@nestjs/common";

import { OrdersModule } from "../orders/orders.module";
import { ShopifyAdminClient } from "./shopify-admin.client";
import { ShopifyAppController, ShopifyFulfilmentController, ShopifyWebhooksController } from "./shopify.controllers";
import { ShopifyFulfilmentService } from "./shopify-fulfilment.service";
import { ShopifyJobs } from "./shopify.jobs";
import { ShopifySessionGuard } from "./shopify-session.guard";
import { ShopifyShopsService } from "./shopify-shops.service";
import { ShopifyWebhooksService } from "./shopify-webhooks.service";

@Module({
  imports: [OrdersModule],
  controllers: [ShopifyAppController, ShopifyFulfilmentController, ShopifyWebhooksController],
  providers: [ShopifyAdminClient, ShopifySessionGuard, ShopifyShopsService, ShopifyFulfilmentService, ShopifyWebhooksService, ShopifyJobs],
})
export class ShopifyModule {}
