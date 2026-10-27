import { Inject, Injectable, Logger } from "@nestjs/common";
import { Cron } from "@nestjs/schedule";

import { APP_CONFIG } from "../../config/config.module";
import type { AppConfig } from "../../config/config.schema";
import { lockRow, PrismaService } from "../../database/prisma.service";
import { AuditService, SYSTEM_ACTOR } from "../../infrastructure/audit/audit.service";
import { RETURN_RULES } from "../../shared";
import { JobLockService } from "../finance/jobs/job-lock.service";
import { ReturnAlertsService } from "./return-alerts.service";
import { ReturnEmails } from "./return-emails";
import { ReturnFeesService } from "./return-fees.service";
import { addDays } from "./vendor-returns.repository";

const LOCK_MS = 15 * 60 * 1000;
const BATCH = 200;

@Injectable()
export class ReturnUpkeepService {
  private readonly logger = new Logger(ReturnUpkeepService.name);

  constructor(
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    private readonly prisma: PrismaService,
    private readonly locks: JobLockService,
    private readonly fees: ReturnFeesService,
    private readonly owners: ReturnAlertsService,
    private readonly audit: AuditService,
  ) {}

  @Cron("40 2 * * *", { timeZone: "UTC" })
  async daily(): Promise<void> {
    if (!this.config.JOBS_ENABLED) {
      return;
    }
    const summary = await this.locks.runExclusive("return-upkeep", LOCK_MS, async () => ({ expired: await this.expireUnreceived(), restocked: await this.restockUninstructed() }));
    if (summary && (summary.expired || summary.restocked)) {
      this.logger.log(`Return upkeep: ${JSON.stringify(summary)}`);
    }
  }

  async expireUnreceived(now = new Date()): Promise<number> {
    const due = await this.prisma.vendorReturn.findMany({ where: { status: "REQUESTED", createdAt: { lt: addDays(now, -RETURN_RULES.receiveDays) } }, take: BATCH });
    let expired = 0;
    for (const entry of due) {
      const closed = await this.prisma.$transaction(async (tx) => {
        await lockRow(tx, "vendorReturns", entry.id);
        const updated = await tx.vendorReturn.updateMany({ where: { id: entry.id, status: "REQUESTED" }, data: { status: "EXPIRED" } });
        if (updated.count > 0) {
          await this.fees.giveBack(tx, entry, "expired");
          await this.audit.record({ actor: SYSTEM_ACTOR, action: "return.expired", resourceType: "vendor_return", resourceId: entry.id, vendorId: entry.vendorId }, tx);
        }
        return updated.count;
      });
      if (closed) {
        expired += 1;
        await this.owners.tellOwner(entry, (to, webUrl) => ReturnEmails.expired(to, entry.reference, webUrl));
      }
    }
    return expired;
  }

  async restockUninstructed(now = new Date()): Promise<number> {
    const due = await this.prisma.vendorReturn.findMany({ where: { status: "RECEIVED", receivedAt: { lt: addDays(now, -RETURN_RULES.instructionDays) } }, include: { lines: true }, take: BATCH });
    let restocked = 0;
    for (const entry of due) {
      const done = await this.prisma.$transaction(async (tx) => {
        await lockRow(tx, "vendorReturns", entry.id);
        const updated = await tx.vendorReturn.updateMany({ where: { id: entry.id, status: "RECEIVED" }, data: { status: "INSTRUCTED", instructedAt: now } });
        if (updated.count === 0) {
          return false;
        }
        for (const line of entry.lines) {
          await tx.vendorReturnLine.update({ where: { id: line.id }, data: { restockQuantity: line.receivedQuantity ?? 0, disposeQuantity: 0, donateQuantity: 0 } });
        }
        await this.audit.record({ actor: SYSTEM_ACTOR, action: "return.restock_by_default", resourceType: "vendor_return", resourceId: entry.id, vendorId: entry.vendorId }, tx);
        return true;
      });
      if (done) {
        restocked += 1;
        await this.owners.tellOwner(entry, (to, webUrl) => ReturnEmails.autoRestocked(to, entry.reference, webUrl));
        await this.owners.readyToFinish(entry, "The vendor didn't answer in time, so restock everything, then finish the return.");
      }
    }
    return restocked;
  }
}
