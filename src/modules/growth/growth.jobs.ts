import { Inject, Injectable, Logger } from "@nestjs/common";
import { Cron } from "@nestjs/schedule";

import { APP_CONFIG } from "../../config/config.module";
import type { AppConfig } from "../../config/config.schema";
import { JobLockService } from "../finance/jobs/job-lock.service";
import { ReferralRewardsService } from "./referral-rewards.service";
import { ReferralsService } from "./referrals.service";

const LOCK_MS = 15 * 60 * 1000;

@Injectable()
export class GrowthJobs {
  private readonly logger = new Logger(GrowthJobs.name);

  constructor(
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    private readonly locks: JobLockService,
    private readonly referrals: ReferralsService,
    private readonly rewards: ReferralRewardsService,
  ) {}

  @Cron("25 * * * *", { timeZone: "UTC" })
  async hourly(): Promise<void> {
    if (!this.config.JOBS_ENABLED) {
      return;
    }
    const summary = await this.locks.runExclusive("referrals", LOCK_MS, async () => ({ attributed: await this.referrals.attributePending(), rewarded: await this.rewards.rewardDue() }));
    if (summary && (summary.attributed || summary.rewarded)) {
      this.logger.log(`Referrals: ${JSON.stringify(summary)}`);
    }
  }
}
