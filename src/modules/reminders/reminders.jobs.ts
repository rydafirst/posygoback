import { Inject, Injectable, Logger } from "@nestjs/common";
import { Cron } from "@nestjs/schedule";

import { APP_CONFIG } from "../../config/config.module";
import type { AppConfig } from "../../config/config.schema";
import { JobLockService } from "../finance/jobs/job-lock.service";
import { RemindersService } from "./reminders.service";

const LOCK_MS = 15 * 60 * 1000;

@Injectable()
export class ReminderJobs {
  private readonly logger = new Logger(ReminderJobs.name);

  constructor(
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    private readonly locks: JobLockService,
    private readonly reminders: RemindersService,
  ) {}

  @Cron("20 10,16 * * *", { timeZone: "Europe/London" })
  async twiceDaily(): Promise<void> {
    if (!this.config.JOBS_ENABLED) {
      return;
    }
    const sent = await this.locks.runExclusive("reminders", LOCK_MS, () => this.reminders.run(new Date()));
    if (sent) {
      this.logger.log(`Reminders sent: ${sent}`);
    }
  }
}
