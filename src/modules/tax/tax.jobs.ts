import { Inject, Injectable, Logger } from "@nestjs/common";
import { Cron } from "@nestjs/schedule";

import { APP_CONFIG } from "../../config/config.module";
import type { AppConfig } from "../../config/config.schema";
import { JobLockService } from "../finance/jobs/job-lock.service";
import { today } from "./tax-dates";
import { TaxRemindersService } from "./tax-reminders.service";

const LOCK_MS = 10 * 60 * 1000;

@Injectable()
export class TaxJobs {
  private readonly logger = new Logger(TaxJobs.name);

  constructor(
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    private readonly locks: JobLockService,
    private readonly reminders: TaxRemindersService,
  ) {}

  @Cron("40 7 * * *", { timeZone: "UTC" })
  async daily(): Promise<void> {
    if (!this.config.JOBS_ENABLED) {
      return;
    }
    const sent = await this.locks.runExclusive("tax-reminders", LOCK_MS, () => this.reminders.send(today()));
    if (sent) {
      this.logger.log(`Tax reminders sent: ${sent}`);
    }
  }
}
