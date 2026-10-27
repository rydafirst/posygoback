import { Injectable } from "@nestjs/common";

import type { AuthPrincipal, RequestMeta } from "../../../common/auth/auth-principal";
import { Errors } from "../../../common/http/app-exception";
import { PrismaService } from "../../../database/prisma.service";
import type { WalletStatus } from "../../../generated/prisma/client";
import { AuditService } from "../../../infrastructure/audit/audit.service";
import type { ReconciliationReportView, WalletView } from "../../../shared";
import { FinanceEmails } from "../finance-emails";
import { WalletAlertsService } from "./wallet-alerts.service";
import { toWalletView, WalletsService } from "./wallets.service";

const WALLET_INCLUDE = { vendor: { select: { businessName: true, countryCode: true } } } as const;

@Injectable()
export class FinanceWalletsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly wallets: WalletsService,
    private readonly audit: AuditService,
    private readonly alerts: WalletAlertsService,
  ) {}

  async list(filters: { countryCode?: string; status?: WalletStatus }): Promise<WalletView[]> {
    const rows = await this.prisma.wallet.findMany({
      where: { ...(filters.status ? { status: filters.status } : {}), ...(filters.countryCode ? { vendor: { countryCode: filters.countryCode } } : {}) },
      include: WALLET_INCLUDE,
      orderBy: { updatedAt: "desc" },
      take: 500,
    });
    return rows.map(toWalletView);
  }

  async detail(walletId: string) {
    const wallet = await this.prisma.wallet.findUnique({ where: { id: walletId }, include: WALLET_INCLUDE });
    if (!wallet) {
      throw Errors.notFound();
    }
    return { wallet: toWalletView(wallet), ledger: await this.wallets.entries(wallet.id) };
  }

  async setFrozen(principal: AuthPrincipal, walletId: string, frozen: boolean, reason: string, meta: RequestMeta): Promise<WalletView> {
    const wallet = await this.prisma.wallet.findUnique({ where: { id: walletId } });
    if (!wallet || wallet.status === "CLOSED") {
      throw Errors.notFound();
    }
    const updated = await this.prisma.$transaction(async (tx) => {
      const row = await tx.wallet.update({ where: { id: walletId }, data: { status: frozen ? "FROZEN" : "ACTIVE", overdueSince: null }, include: WALLET_INCLUDE });
      await this.audit.record(
        {
          actor: { userId: principal.userId, role: principal.role },
          action: frozen ? "wallet.frozen" : "wallet.unfrozen",
          resourceType: "wallet",
          resourceId: walletId,
          vendorId: wallet.vendorId,
          before: { status: wallet.status },
          after: { reason },
          meta,
        },
        tx,
      );
      return row;
    });
    if (frozen && wallet.status !== "FROZEN") {
      await this.alerts.notifyOwner(wallet.vendorId, FinanceEmails.walletPausedManually, "/wallet");
    } else if (!frozen && wallet.status === "FROZEN") {
      await this.alerts.notifyOwner(wallet.vendorId, FinanceEmails.walletUnpaused, "/wallet");
    }
    return toWalletView(updated);
  }

  async reconciliationReports(): Promise<ReconciliationReportView[]> {
    const rows = await this.prisma.reconciliationReport.findMany({ orderBy: { ranAt: "desc" }, take: 30 });
    return rows.map((row) => ({ id: row.id, ranAt: row.ranAt.toISOString(), walletsChecked: row.walletsChecked, mismatches: row.mismatches as ReconciliationReportView["mismatches"] }));
  }
}
