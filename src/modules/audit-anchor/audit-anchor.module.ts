import { Inject, Injectable, Logger, Module } from "@nestjs/common";
import { Cron } from "@nestjs/schedule";

import { APP_CONFIG } from "../../config/config.module";
import type { AppConfig } from "../../config/config.schema";
import { FilesModule } from "../files/files.module";
import { FinanceModule } from "../finance/finance.module";
import { JobLockService } from "../finance/jobs/job-lock.service";
import { AuditAnchorService } from "./audit-anchor.service";

const HOUR_MS = 60 * 60 * 1000;

@Injectable()
export class AuditAnchorJob {
  private readonly logger = new Logger(AuditAnchorJob.name);

  constructor(
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    private readonly locks: JobLockService,
    private readonly anchors: AuditAnchorService,
  ) {}

  @Cron("50 23 * * *", { timeZone: "UTC" })
  async daily(): Promise<void> {
    if (!this.config.JOBS_ENABLED) {
      return;
    }
    const anchor = await this.locks.runExclusive("audit-anchor", HOUR_MS, () => this.anchors.anchor());
    if (anchor) {
      this.logger.log(`Audit chain anchored at sequence ${anchor.sequence}`);
    }
  }
}

@Module({ imports: [FilesModule, FinanceModule], providers: [AuditAnchorService, AuditAnchorJob] })
export class AuditAnchorModule {}
