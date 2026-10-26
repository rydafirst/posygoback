import { Inject, Injectable, Logger } from "@nestjs/common";
import { Cron } from "@nestjs/schedule";

import { APP_CONFIG } from "../../../config/config.module";
import type { AppConfig } from "../../../config/config.schema";
import { JobLockService } from "../../finance/jobs/job-lock.service";
import { CustodyUpkeepService } from "./custody-upkeep.service";
import { PartnerUpkeepService } from "./partner-upkeep.service";

const HOUR_MS = 60 * 60 * 1000;

@Injectable()
export class PartnerJobs {
  private readonly logger = new Logger(PartnerJobs.name);

  constructor(
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    private readonly locks: JobLockService,
    private readonly upkeep: PartnerUpkeepService,
    private readonly custody: CustodyUpkeepService,
  ) {}

  @Cron("30 2 * * *", { timeZone: "UTC" })
  async daily(): Promise<void> {
    if (!this.config.JOBS_ENABLED) {
      return;
    }
    const summary = await this.locks.runExclusive("partner-upkeep", HOUR_MS, () => this.upkeep.run());
    if (summary) {
      this.logger.log(`Partner upkeep: ${JSON.stringify(summary)}`);
    }
    const custody = await this.locks.runExclusive("custody-upkeep", HOUR_MS, () => this.custody.run());
    if (custody) {
      this.logger.log(`Custody upkeep: ${JSON.stringify(custody)}`);
    }
  }
}
