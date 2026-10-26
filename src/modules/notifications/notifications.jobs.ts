import { Inject, Injectable } from "@nestjs/common";
import { Cron } from "@nestjs/schedule";

import { APP_CONFIG } from "../../config/config.module";
import type { AppConfig } from "../../config/config.schema";
import { NotificationsService } from "./notifications.service";

@Injectable()
export class NotificationsJobs {
  constructor(
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    private readonly notifications: NotificationsService,
  ) {}

  @Cron("50 3 * * *", { timeZone: "UTC" })
  async prune(): Promise<void> {
    if (this.config.JOBS_ENABLED) {
      await this.notifications.prune();
    }
  }
}
