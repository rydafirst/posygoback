import { Inject, Injectable } from "@nestjs/common";
import { Cron } from "@nestjs/schedule";

import { APP_CONFIG } from "../../config/config.module";
import type { AppConfig } from "../../config/config.schema";
import { DraftsService } from "./drafts.service";

@Injectable()
export class DraftsJobs {
  constructor(
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    private readonly drafts: DraftsService,
  ) {}

  @Cron("55 3 * * *", { timeZone: "UTC" })
  async prune(): Promise<void> {
    if (this.config.JOBS_ENABLED) {
      await this.drafts.removeExpired();
    }
  }
}
