import { Inject, Injectable, Logger } from "@nestjs/common";
import { Cron } from "@nestjs/schedule";

import { APP_CONFIG } from "../../config/config.module";
import type { AppConfig } from "../../config/config.schema";
import { JobLockService } from "../finance/jobs/job-lock.service";
import { StorefrontFulfilmentService } from "./orders/storefront-fulfilment.service";
import { StorefrontOrdersService } from "./orders/storefront-orders.service";
import { StorefrontPayoutsService } from "./orders/storefront-payouts.service";
import { ShoppingQuotesService } from "./shopping/shopping-quotes.service";
import { ShoppingRefundsService } from "./shopping/shopping-refunds.service";
import { ShoppingRequestsService } from "./shopping/shopping-requests.service";

const LOCK_MS = 15 * 60 * 1000;

@Injectable()
export class CommerceJobs {
  private readonly logger = new Logger(CommerceJobs.name);

  constructor(
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    private readonly locks: JobLockService,
    private readonly orders: StorefrontOrdersService,
    private readonly fulfilment: StorefrontFulfilmentService,
    private readonly payouts: StorefrontPayoutsService,
    private readonly shopping: ShoppingQuotesService,
    private readonly shoppingRequests: ShoppingRequestsService,
    private readonly shoppingRefunds: ShoppingRefundsService,
  ) {}

  @Cron("*/10 * * * *", { timeZone: "UTC" })
  async every10Minutes(): Promise<void> {
    if (!this.config.JOBS_ENABLED) {
      return;
    }
    const summary = await this.locks.runExclusive("storefront-upkeep", LOCK_MS, async () => ({
      expired: await this.orders.expireUnpaid(),
      retried: await this.fulfilment.retryWaiting(),
      synced: await this.fulfilment.syncShipping(),
      quotesExpired: await this.shopping.expireDue(),
      unconfirmed: await this.shoppingRequests.expireUnconfirmed(),
      refundsRetried: await this.shoppingRefunds.retryStale(),
    }));
    if (summary && Object.values(summary).some((count) => count > 0)) {
      this.logger.log(`Storefront upkeep: ${JSON.stringify(summary)}`);
    }
  }

  @Cron("15 * * * *", { timeZone: "UTC" })
  async hourly(): Promise<void> {
    if (!this.config.JOBS_ENABLED) {
      return;
    }
    const paid = await this.locks.runExclusive("storefront-payouts", LOCK_MS, () => this.payouts.releaseDue());
    if (paid) {
      this.logger.log(`Store payouts sent: ${paid}`);
    }
  }
}
