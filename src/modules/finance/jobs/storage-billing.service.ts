import { createHash } from "node:crypto";

import { Injectable, Logger } from "@nestjs/common";

import { addDays, startOfUtcDay } from "../../../common/dates";
import { AppException } from "../../../common/http/app-exception";
import { PrismaService } from "../../../database/prisma.service";
import { AuditService, SYSTEM_ACTOR } from "../../../infrastructure/audit/audit.service";
import { ERROR_CODES, Money } from "../../../shared";
import { PartnerEarningsService } from "../../partners/ledger/partner-earnings.service";
import { FeeSchedulesService } from "../fees/fee-schedules.service";
import { FinanceEmails } from "../finance-emails";
import { WalletAlertsService } from "../wallets/wallet-alerts.service";
import { WalletLedgerService } from "../wallets/wallet-ledger.service";

export const BILLING_CYCLE_DAYS = 30;

export interface BillingRunSummary {
  vendorsCharged: number;
  vendorsOverdue: number;
  boxesBilled: number;
}

function digest(parts: string[]): string {
  return createHash("sha256").update(parts.sort().join("|")).digest("hex").slice(0, 32);
}

export { addDays, startOfUtcDay };

@Injectable()
export class StorageBillingService {
  private readonly logger = new Logger(StorageBillingService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly ledger: WalletLedgerService,
    private readonly fees: FeeSchedulesService,
    private readonly alerts: WalletAlertsService,
    private readonly earnings: PartnerEarningsService,
    private readonly audit: AuditService,
  ) {}

  async run(today: Date = startOfUtcDay(new Date())): Promise<BillingRunSummary> {
    const due = await this.prisma.storageBox.groupBy({ by: ["vendorId"], where: { removedAt: null, nextBillingDate: { lte: today } } });
    const summary: BillingRunSummary = { vendorsCharged: 0, vendorsOverdue: 0, boxesBilled: 0 };
    for (const { vendorId } of due) {
      try {
        const billed = await this.billVendor(vendorId, today);
        summary.boxesBilled += billed > 0 ? billed : 0;
        summary.vendorsCharged += billed > 0 ? 1 : 0;
        summary.vendorsOverdue += billed < 0 ? 1 : 0;
      } catch (error) {
        this.logger.error(`Storage billing failed for vendor ${vendorId}: ${String(error)}`);
      }
    }
    return summary;
  }

  private async billVendor(vendorId: string, today: Date): Promise<number> {
    const vendor = await this.prisma.vendor.findUniqueOrThrow({ where: { id: vendorId }, include: { country: { select: { currency: true } } } });
    const { schedule } = await this.fees.active(vendor.countryCode);
    const boxes = await this.prisma.storageBox.findMany({ where: { vendorId, removedAt: null, nextBillingDate: { lte: today } } });
    const billable = boxes.filter((box) => schedule.monthlyStorage[box.tier] !== null);
    const amountMinor = billable.reduce((total, box) => total + (schedule.monthlyStorage[box.tier] ?? 0), 0);
    if (billable.length === 0 || amountMinor === 0) {
      return 0;
    }
    const wallet = await this.ledger.walletFor(this.prisma, vendorId, vendor.country.currency);
    const runKey = `storage:${today.toISOString().slice(0, 10)}:${digest(billable.map((box) => `${box.id}@${box.nextBillingDate!.toISOString()}`))}`;
    try {
      const posting = await this.prisma.$transaction(async (tx) => {
        const result = await this.ledger.post(tx, wallet.id, {
          type: "STORAGE",
          amountMinor,
          description: `Storage for ${billable.length} ${billable.length === 1 ? "box" : "boxes"}`,
          idempotencyKey: runKey,
          reference: { type: "storage_run", id: today.toISOString().slice(0, 10) },
        });
        if (result.duplicate) {
          return result;
        }
        await this.earnings.storageBilled(tx, schedule, billable, `${runKey}:${vendorId}`);
        for (const box of billable) {
          await tx.storageBox.update({ where: { id: box.id }, data: { nextBillingDate: addDays(box.nextBillingDate!, BILLING_CYCLE_DAYS) } });
        }
        if (result.wallet.status === "STORAGE_OVERDUE") {
          await tx.wallet.update({ where: { id: wallet.id }, data: { status: "ACTIVE", overdueSince: null } });
        }
        return result;
      });
      await this.alerts.afterPosting(posting);
      return billable.length;
    } catch (error) {
      if (!(error instanceof AppException) || (error.code !== ERROR_CODES.insufficientFunds && error.code !== ERROR_CODES.walletUnavailable)) {
        throw error;
      }
      await this.markOverdue(wallet.id, vendorId, amountMinor, vendor.country.currency);
      return -1;
    }
  }

  private async markOverdue(walletId: string, vendorId: string, amountMinor: number, currency: string): Promise<void> {
    const flipped = await this.prisma.wallet.updateMany({ where: { id: walletId, status: "ACTIVE" }, data: { status: "STORAGE_OVERDUE", overdueSince: new Date() } });
    if (flipped.count === 0) {
      return;
    }
    await this.audit.record({ actor: SYSTEM_ACTOR, action: "wallet.storage_overdue", resourceType: "wallet", resourceId: walletId, vendorId, after: { amountMinor } });
    const due = Money.of(amountMinor, currency).format("en-GB");
    await this.alerts.notifyOwner(vendorId, (to) => FinanceEmails.storageOverdue(to, due), "/wallet");
  }
}
