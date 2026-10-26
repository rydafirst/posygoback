import { Injectable } from "@nestjs/common";

import { PrismaService } from "../../../database/prisma.service";
import { AuditService, SYSTEM_ACTOR } from "../../../infrastructure/audit/audit.service";
import type { ReconciliationReportView } from "../../../shared";

@Injectable()
export class ReconciliationService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async run(): Promise<ReconciliationReportView> {
    const rows = await this.prisma.$queryRaw<Array<{ id: string; balance: bigint; ledger: bigint }>>`
      SELECT w.id, w.balance_minor AS balance, COALESCE((SELECT sum(amount_minor) FROM ledger_entries e WHERE e.wallet_id = w.id), 0)::bigint AS ledger
      FROM wallets w`;
    const mismatches = rows.filter((row) => row.balance !== row.ledger).map((row) => ({ walletId: row.id, balanceMinor: Number(row.balance), ledgerSumMinor: Number(row.ledger) }));
    const report = await this.prisma.reconciliationReport.create({ data: { walletsChecked: rows.length, mismatches } });
    for (const mismatch of mismatches) {
      await this.audit.record({ actor: SYSTEM_ACTOR, action: "wallet.reconciliation_mismatch", resourceType: "wallet", resourceId: mismatch.walletId, after: mismatch });
    }
    return { id: report.id, ranAt: report.ranAt.toISOString(), walletsChecked: rows.length, mismatches };
  }
}
