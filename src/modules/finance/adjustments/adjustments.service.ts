import { Injectable } from "@nestjs/common";

import type { AuthPrincipal, RequestMeta } from "../../../common/auth/auth-principal";
import { Errors } from "../../../common/http/app-exception";
import { lockRow, PrismaService } from "../../../database/prisma.service";
import type { AdjustmentStatus, Prisma, WalletAdjustment } from "../../../generated/prisma/client";
import { AuditService } from "../../../infrastructure/audit/audit.service";
import { type AdjustmentDecisionInput, type AdjustmentView, Money, type RequestAdjustmentInput } from "../../../shared";
import { StaffAlertsService } from "../../notifications/staff-alerts.service";
import { FinanceEmails } from "../finance-emails";
import { FeeSchedulesService } from "../fees/fee-schedules.service";
import { WalletAlertsService } from "../wallets/wallet-alerts.service";
import { type PostingResult, WalletLedgerService } from "../wallets/wallet-ledger.service";

const VIEW_INCLUDE = {
  wallet: { select: { currency: true, vendor: { select: { businessName: true } } } },
  requester: { select: { email: true } },
  decider: { select: { email: true } },
} satisfies Prisma.WalletAdjustmentInclude;

type AdjustmentWithPeople = Prisma.WalletAdjustmentGetPayload<{ include: typeof VIEW_INCLUDE }>;

function toView(row: AdjustmentWithPeople): AdjustmentView {
  return {
    id: row.id,
    walletId: row.walletId,
    businessName: row.wallet.vendor.businessName,
    currency: row.wallet.currency,
    direction: row.direction,
    amountMinor: Number(row.amountMinor),
    reason: row.reason,
    reference: row.reference,
    status: row.status,
    requestedByEmail: row.requester.email,
    decidedByEmail: row.decider?.email ?? null,
    decisionNote: row.decisionNote,
    createdAt: row.createdAt.toISOString(),
  };
}

const DAY_MS = 24 * 60 * 60 * 1000;

@Injectable()
export class AdjustmentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly ledger: WalletLedgerService,
    private readonly fees: FeeSchedulesService,
    private readonly alerts: WalletAlertsService,
    private readonly audit: AuditService,
    private readonly staffAlerts: StaffAlertsService,
  ) {}

  async list(status?: AdjustmentStatus, walletId?: string): Promise<AdjustmentView[]> {
    const rows = await this.prisma.walletAdjustment.findMany({
      where: { ...(status ? { status } : {}), ...(walletId ? { walletId } : {}) },
      include: VIEW_INCLUDE,
      orderBy: { createdAt: "desc" },
      take: 200,
    });
    return rows.map(toView);
  }

  async request(principal: AuthPrincipal, walletId: string, input: RequestAdjustmentInput, meta: RequestMeta): Promise<AdjustmentView> {
    const wallet = await this.prisma.wallet.findUnique({ where: { id: walletId }, include: { vendor: { select: { countryCode: true } } } });
    if (!wallet) {
      throw Errors.notFound();
    }
    const { schedule } = await this.fees.active(wallet.vendor.countryCode);
    let posting: PostingResult | null = null;
    const created = await this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`adjustments:${principal.userId}`}))`;
      const today = await tx.walletAdjustment.aggregate({
        where: { requestedBy: principal.userId, status: { not: "REJECTED" }, createdAt: { gt: new Date(Date.now() - DAY_MS) }, wallet: { currency: wallet.currency } },
        _sum: { amountMinor: true },
      });
      if (Number(today._sum.amountMinor ?? 0n) + input.amountMinor > schedule.adjustments.dailyCapPerPersonMinor) {
        throw Errors.dailyLimitReached();
      }
      const adjustment = await tx.walletAdjustment.create({
        data: { walletId, direction: input.direction, amountMinor: BigInt(input.amountMinor), reason: input.reason, reference: input.reference ?? null, requestedBy: principal.userId },
      });
      await this.audit.record(
        {
          actor: { userId: principal.userId, role: principal.role },
          action: "wallet_adjustment.requested",
          resourceType: "wallet_adjustment",
          resourceId: adjustment.id,
          vendorId: wallet.vendorId,
          countryCode: wallet.vendor.countryCode,
          after: input,
          meta,
        },
        tx,
      );
      if (input.amountMinor <= schedule.adjustments.dualApprovalAboveMinor) {
        posting = await this.apply(tx, adjustment, principal, null, "Within the single-approval limit", meta);
      }
      return tx.walletAdjustment.findUniqueOrThrow({ where: { id: adjustment.id }, include: VIEW_INCLUDE });
    });
    await this.followUp(posting);
    if (created.status === "PENDING_APPROVAL") {
      await this.askForApproval(created, wallet.vendor.countryCode);
    }
    return toView(created);
  }

  async decide(principal: AuthPrincipal, adjustmentId: string, input: AdjustmentDecisionInput, meta: RequestMeta): Promise<AdjustmentView> {
    let posting: PostingResult | null = null;
    const decided = await this.prisma.$transaction(async (tx) => {
      await lockRow(tx, "walletAdjustments", adjustmentId);
      const adjustment = await tx.walletAdjustment.findUnique({ where: { id: adjustmentId } });
      if (!adjustment) {
        throw Errors.notFound();
      }
      if (adjustment.status !== "PENDING_APPROVAL") {
        throw Errors.invalidTransition("This adjustment has already been decided.");
      }
      if (adjustment.requestedBy === principal.userId) {
        throw Errors.forbidden("Someone other than the requester must approve this adjustment.");
      }
      if (input.approve) {
        posting = await this.apply(tx, adjustment, principal, principal.userId, input.note, meta);
      } else {
        await tx.walletAdjustment.update({ where: { id: adjustment.id }, data: { status: "REJECTED", decidedBy: principal.userId, decidedAt: new Date(), decisionNote: input.note } });
        await this.audit.record(
          {
            actor: { userId: principal.userId, role: principal.role },
            action: "wallet_adjustment.rejected",
            resourceType: "wallet_adjustment",
            resourceId: adjustment.id,
            after: { note: input.note },
            meta,
          },
          tx,
        );
      }
      return tx.walletAdjustment.findUniqueOrThrow({ where: { id: adjustment.id }, include: VIEW_INCLUDE });
    });
    await this.followUp(posting);
    return toView(decided);
  }

  private async apply(tx: Prisma.TransactionClient, adjustment: WalletAdjustment, principal: AuthPrincipal, approverId: string | null, note: string, meta: RequestMeta): Promise<PostingResult> {
    const credit = adjustment.direction === "CREDIT";
    const result = await this.ledger.post(tx, adjustment.walletId, {
      type: credit ? "MANUAL_CREDIT" : "MANUAL_DEBIT",
      amountMinor: Number(adjustment.amountMinor),
      description: adjustment.reason,
      idempotencyKey: `adjustment:${adjustment.id}`,
      reference: { type: "wallet_adjustment", id: adjustment.id },
      actorId: adjustment.requestedBy,
    });
    await tx.walletAdjustment.update({ where: { id: adjustment.id }, data: { status: "APPLIED", decidedBy: approverId, decidedAt: new Date(), decisionNote: note, ledgerEntryId: result.entry.id } });
    await this.audit.record(
      {
        actor: { userId: principal.userId, role: principal.role },
        action: "wallet_adjustment.applied",
        resourceType: "wallet_adjustment",
        resourceId: adjustment.id,
        vendorId: result.wallet.vendorId,
        after: { ledgerEntryId: result.entry.id },
        meta,
      },
      tx,
    );
    return result;
  }

  private async askForApproval(adjustment: AdjustmentWithPeople, countryCode: string): Promise<void> {
    const amount = Money.of(Number(adjustment.amountMinor), adjustment.wallet.currency).format("en-GB");
    const kind = adjustment.direction === "CREDIT" ? "credit" : "debit";
    await this.staffAlerts.raise("adjustments", {
      countryCode,
      title: `${amount} wallet adjustment for ${adjustment.wallet.vendor.businessName} to approve`,
      body: `${adjustment.requester.email} asked for a ${kind} because: ${adjustment.reason}`,
      exceptUserId: adjustment.requestedBy,
    });
  }

  private async followUp(posting: PostingResult | null): Promise<void> {
    if (!posting || posting.duplicate) {
      return;
    }
    const { entry, wallet } = posting;
    const amount = Money.of(Math.abs(Number(entry.amountMinor)), wallet.currency).format("en-GB");
    const balance = Money.of(Number(wallet.balanceMinor), wallet.currency).format("en-GB");
    const email = entry.type === "MANUAL_CREDIT" ? FinanceEmails.walletCredited : FinanceEmails.walletDebited;
    await this.alerts.notifyOwner(wallet.vendorId, (to, webUrl) => email(to, amount, entry.description, balance, webUrl), "/wallet");
    await this.alerts.afterPosting(posting);
  }
}
