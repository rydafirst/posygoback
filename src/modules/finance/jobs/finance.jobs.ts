import { Inject, Injectable, Logger } from "@nestjs/common";
import { Cron } from "@nestjs/schedule";

import { APP_CONFIG } from "../../../config/config.module";
import type { AppConfig } from "../../../config/config.schema";
import { JobLockService } from "./job-lock.service";
import { ReconciliationService } from "./reconciliation.service";
import { StorageBillingService } from "./storage-billing.service";

const HOUR_MS = 60 * 60 * 1000;

@Injectable()
export class FinanceJobs {
  private readonly logger = new Logger(FinanceJobs.name);

  constructor(
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    private readonly locks: JobLockService,
    private readonly billing: StorageBillingService,
    private readonly reconciliation: ReconciliationService,
  ) {}

  @Cron("0 2 * * *", { timeZone: "UTC" })
  async storageBilling(): Promise<void> {
    if (!this.config.JOBS_ENABLED) {
      return;
    }
    const summary = await this.locks.runExclusive("storage-billing", HOUR_MS, () => this.billing.run());
    if (summary) {
      this.logger.log(`Storage billing: ${JSON.stringify(summary)}`);
    }
  }

  @Cron("0 3 * * *", { timeZone: "UTC" })
  async reconcile(): Promise<void> {
    if (!this.config.JOBS_ENABLED) {
      return;
    }
    const report = await this.locks.runExclusive("wallet-reconciliation", HOUR_MS, () => this.reconciliation.run());
    if (report && report.mismatches.length > 0) {
      this.logger.error(`Wallet reconciliation found ${report.mismatches.length} mismatches`);
    }
  }
}
