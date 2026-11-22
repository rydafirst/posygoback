import { Inject, Injectable } from "@nestjs/common";
import { Cron } from "@nestjs/schedule";

import { APP_CONFIG } from "../../config/config.module";
import type { AppConfig } from "../../config/config.schema";
import { ShopifyAdminClient } from "./shopify-admin.client";
import { ShopifyFulfilmentService } from "./shopify-fulfilment.service";

@Injectable()
export class ShopifyJobs {
  constructor(
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    private readonly shopify: ShopifyAdminClient,
    private readonly fulfilment: ShopifyFulfilmentService,
  ) {}

  @Cron("*/10 * * * *", { timeZone: "UTC" })
  async sendShipments(): Promise<void> {
    if (this.config.JOBS_ENABLED && this.shopify.configured) {
      await this.fulfilment.syncShipments();
    }
  }
}
