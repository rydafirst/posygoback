import { Injectable } from "@nestjs/common";

import type { AuthPrincipal, RequestMeta } from "../../../common/auth/auth-principal";
import { Errors } from "../../../common/http/app-exception";
import { lockRow, PrismaService } from "../../../database/prisma.service";
import type { AdjustmentStatus, PartnerAdjustment, Prisma, WalletAdjustment } from "../../../generated/prisma/client";
import { AuditService } from "../../../infrastructure/audit/audit.service";
import { type AdjustmentAccountKind, type AdjustmentDecisionInput, type AdjustmentView, Money, type RequestAdjustmentInput } from "../../../shared";
import { StaffAlertsService } from "../../notifications/staff-alerts.service";
import { PartnerLedgerService } from "../../partners/ledger/partner-ledger.service";
import { PartnerNotifierService } from "../../partners/partner-notifier.service";
import { FinanceEmails } from "../finance-emails";
import { FeeSchedulesService } from "../fees/fee-schedules.service";
import { WalletAlertsService } from "../wallets/wallet-alerts.service";
import { type PostingResult, WalletLedgerService } from "../wallets/wallet-ledger.service";
import { WALLET_INCLUDE, walletCountryCode } from "../wallets/wallets.service";

const PEOPLE = { requester: { select: { email: true } }, decider: { select: { email: true } } } as const;
const VENDOR_INCLUDE = { wallet: { select: { currency: true, vendor: { select: { businessName: true } } } }, ...PEOPLE } satisfies Prisma.WalletAdjustmentInclude;
const PARTNER_INCLUDE = { partner: { select: { legalName: true, countryCode: true } }, ...PEOPLE } satisfies Prisma.PartnerAdjustmentInclude;

type VendorAdjustmentRow = Prisma.WalletAdjustmentGetPayload<{ include: typeof VENDOR_INCLUDE }>;
type PartnerAdjustmentRow = Prisma.PartnerAdjustmentGetPayload<{ include: typeof PARTNER_INCLUDE }>;
type AdjustmentRow = WalletAdjustment | PartnerAdjustment;

interface PartnerPosting {
  partnerId: string;
  currency: string;
  direction: "CREDIT" | "DEBIT";
  amountMinor: number;
  reason: string;
}

function baseView(row: VendorAdjustmentRow | PartnerAdjustmentRow, currency: string) {
  return {
    id: row.id,
    currency,
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

function vendorView(row: VendorAdjustmentRow): AdjustmentView {
  return { ...baseView(row, row.wallet.currency), accountKind: "VENDOR", accountId: row.walletId, walletId: row.walletId, businessName: row.wallet.vendor.businessName };
}

function partnerView(row: PartnerAdjustmentRow): AdjustmentView {
  return { ...baseView(row, row.currency), accountKind: "PARTNER", accountId: row.partnerId, walletId: null, businessName: row.partner.legalName };
}

const DAY_MS = 24 * 60 * 60 * 1000;
const LIST_SIZE = 200;

@Injectable()
export class AdjustmentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly ledger: WalletLedgerService,
    private readonly partnerLedger: PartnerLedgerService,
    private readonly fees: FeeSchedulesService,
    private readonly alerts: WalletAlertsService,
    private readonly partnerNotifier: PartnerNotifierService,
    private readonly audit: AuditService,
    private readonly staffAlerts: StaffAlertsService,
  ) {}

  async list(status?: AdjustmentStatus, account?: { kind: AdjustmentAccountKind; id: string }): Promise<AdjustmentView[]> {
    const where = status ? { status } : {};
    const [vendors, partners] = await Promise.all([
      account?.kind === "PARTNER" ? [] : this.prisma.walletAdjustment.findMany({ where: { ...where, ...(account ? { walletId: account.id } : {}) }, include: VENDOR_INCLUDE, orderBy: { createdAt: "desc" }, take: LIST_SIZE }),
      account?.kind === "VENDOR" ? [] : this.prisma.partnerAdjustment.findMany({ where: { ...where, ...(account ? { partnerId: account.id } : {}) }, include: PARTNER_INCLUDE, orderBy: { createdAt: "desc" }, take: LIST_SIZE }),
    ]);
    return [...vendors.map(vendorView), ...partners.map(partnerView)].sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, LIST_SIZE);
  }

  async request(principal: AuthPrincipal, walletId: string, input: RequestAdjustmentInput, meta: RequestMeta): Promise<AdjustmentView> {
    const wallet = await this.prisma.wallet.findUnique({ where: { id: walletId }, include: WALLET_INCLUDE });
    if (!wallet) {
      throw Errors.notFound();
    }
    const countryCode = walletCountryCode(wallet);
    const { schedule } = await this.fees.active(countryCode);
    let posting: PostingResult | null = null;
    const created = await this.prisma.$transaction(async (tx) => {
      await this.withinDailyCap(tx, principal, wallet.currency, input.amountMinor, schedule.adjustments.dailyCapPerPersonMinor);
      const adjustment = await tx.walletAdjustment.create({
        data: { walletId, direction: input.direction, amountMinor: BigInt(input.amountMinor), reason: input.reason, reference: input.reference ?? null, requestedBy: principal.userId },
      });
      await this.recordRequest(tx, principal, adjustment.id, input, meta, { vendorId: wallet.vendorId, countryCode });
      if (input.amountMinor <= schedule.adjustments.dualApprovalAboveMinor) {
        posting = await this.applyToWallet(tx, adjustment, principal, null, "Within the single-approval limit", meta);
      }
      return tx.walletAdjustment.findUniqueOrThrow({ where: { id: adjustment.id }, include: VENDOR_INCLUDE });
    });
    await this.followUpWallet(posting);
    if (created.status === "PENDING_APPROVAL") {
      await this.askForApproval(created, wallet.currency, created.wallet.vendor.businessName, countryCode, "wallet");
    }
    return vendorView(created);
  }

  async requestForPartner(principal: AuthPrincipal, partnerId: string, input: RequestAdjustmentInput, meta: RequestMeta): Promise<AdjustmentView> {
    const partner = await this.prisma.fulfilmentPartner.findUnique({ where: { id: partnerId }, select: { countryCode: true, country: { select: { currency: true } } } });
    if (!partner) {
      throw Errors.notFound();
    }
    const currency = partner.country.currency;
    const { schedule } = await this.fees.active(partner.countryCode);
    let applied: PartnerPosting | null = null;
    const created = await this.prisma.$transaction(async (tx) => {
      await this.withinDailyCap(tx, principal, currency, input.amountMinor, schedule.adjustments.dailyCapPerPersonMinor);
      const adjustment = await tx.partnerAdjustment.create({
        data: { partnerId, currency, direction: input.direction, amountMinor: BigInt(input.amountMinor), reason: input.reason, reference: input.reference ?? null, requestedBy: principal.userId },
      });
      await this.recordRequest(tx, principal, adjustment.id, input, meta, { countryCode: partner.countryCode });
      if (input.amountMinor <= schedule.adjustments.dualApprovalAboveMinor) {
        applied = await this.applyToPartner(tx, adjustment, principal, null, "Within the single-approval limit", meta);
      }
      return tx.partnerAdjustment.findUniqueOrThrow({ where: { id: adjustment.id }, include: PARTNER_INCLUDE });
    });
    await this.followUpPartner(applied);
    if (created.status === "PENDING_APPROVAL") {
      await this.askForApproval(created, currency, created.partner.legalName, partner.countryCode, "earnings");
    }
    return partnerView(created);
  }

  async decide(principal: AuthPrincipal, adjustmentId: string, input: AdjustmentDecisionInput, meta: RequestMeta): Promise<AdjustmentView> {
    if (await this.prisma.partnerAdjustment.count({ where: { id: adjustmentId } })) {
      return this.decideForPartner(principal, adjustmentId, input, meta);
    }
    let posting: PostingResult | null = null;
    const decided = await this.prisma.$transaction(async (tx) => {
      await lockRow(tx, "walletAdjustments", adjustmentId);
      const adjustment = this.decidable(await tx.walletAdjustment.findUnique({ where: { id: adjustmentId } }), principal);
      if (input.approve) {
        posting = await this.applyToWallet(tx, adjustment, principal, principal.userId, input.note, meta);
      } else {
        await tx.walletAdjustment.update({ where: { id: adjustment.id }, data: { status: "REJECTED", decidedBy: principal.userId, decidedAt: new Date(), decisionNote: input.note } });
        await this.recordRejection(tx, principal, adjustment.id, input.note, meta);
      }
      return tx.walletAdjustment.findUniqueOrThrow({ where: { id: adjustment.id }, include: VENDOR_INCLUDE });
    });
    await this.followUpWallet(posting);
    return vendorView(decided);
  }

  private async decideForPartner(principal: AuthPrincipal, adjustmentId: string, input: AdjustmentDecisionInput, meta: RequestMeta): Promise<AdjustmentView> {
    let applied: PartnerPosting | null = null;
    const decided = await this.prisma.$transaction(async (tx) => {
      await lockRow(tx, "partnerAdjustments", adjustmentId);
      const adjustment = this.decidable(await tx.partnerAdjustment.findUnique({ where: { id: adjustmentId } }), principal);
      if (input.approve) {
        applied = await this.applyToPartner(tx, adjustment, principal, principal.userId, input.note, meta);
      } else {
        await tx.partnerAdjustment.update({ where: { id: adjustment.id }, data: { status: "REJECTED", decidedBy: principal.userId, decidedAt: new Date(), decisionNote: input.note } });
        await this.recordRejection(tx, principal, adjustment.id, input.note, meta);
      }
      return tx.partnerAdjustment.findUniqueOrThrow({ where: { id: adjustment.id }, include: PARTNER_INCLUDE });
    });
    await this.followUpPartner(applied);
    return partnerView(decided);
  }

  private decidable<Row extends AdjustmentRow>(adjustment: Row | null, principal: AuthPrincipal): Row {
    if (!adjustment) {
      throw Errors.notFound();
    }
    if (adjustment.status !== "PENDING_APPROVAL") {
      throw Errors.invalidTransition("This adjustment has already been decided.");
    }
    if (adjustment.requestedBy === principal.userId) {
      throw Errors.secondPersonRequired("Someone other than the requester must approve this adjustment.");
    }
    return adjustment;
  }

  private async withinDailyCap(tx: Prisma.TransactionClient, principal: AuthPrincipal, currency: string, amountMinor: number, capMinor: number): Promise<void> {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`adjustments:${principal.userId}`}))`;
    const since = new Date(Date.now() - DAY_MS);
    const recent = { requestedBy: principal.userId, status: { not: "REJECTED" as const }, createdAt: { gt: since } };
    const [vendors, partners] = await Promise.all([
      tx.walletAdjustment.aggregate({ where: { ...recent, wallet: { currency } }, _sum: { amountMinor: true } }),
      tx.partnerAdjustment.aggregate({ where: { ...recent, currency }, _sum: { amountMinor: true } }),
    ]);
    if (Number(vendors._sum.amountMinor ?? 0n) + Number(partners._sum.amountMinor ?? 0n) + amountMinor > capMinor) {
      throw Errors.dailyLimitReached();
    }
  }

  private async recordRequest(
    tx: Prisma.TransactionClient,
    principal: AuthPrincipal,
    adjustmentId: string,
    input: RequestAdjustmentInput,
    meta: RequestMeta,
    scope: { vendorId?: string; countryCode: string },
  ): Promise<void> {
    await this.audit.record(
      { actor: { userId: principal.userId, role: principal.role }, action: "wallet_adjustment.requested", resourceType: "wallet_adjustment", resourceId: adjustmentId, ...scope, after: input, meta },
      tx,
    );
  }

  private async recordRejection(tx: Prisma.TransactionClient, principal: AuthPrincipal, adjustmentId: string, note: string, meta: RequestMeta): Promise<void> {
    await this.audit.record(
      { actor: { userId: principal.userId, role: principal.role }, action: "wallet_adjustment.rejected", resourceType: "wallet_adjustment", resourceId: adjustmentId, after: { note }, meta },
      tx,
    );
  }

  private async applyToWallet(tx: Prisma.TransactionClient, adjustment: WalletAdjustment, principal: AuthPrincipal, approverId: string | null, note: string, meta: RequestMeta): Promise<PostingResult> {
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
    await this.recordApplied(tx, principal, adjustment.id, result.entry.id, meta, result.wallet.vendorId);
    return result;
  }

  private async applyToPartner(tx: Prisma.TransactionClient, adjustment: PartnerAdjustment, principal: AuthPrincipal, approverId: string | null, note: string, meta: RequestMeta): Promise<PartnerPosting> {
    const amountMinor = Number(adjustment.amountMinor);
    if (adjustment.direction === "DEBIT") {
      const { availableMinor } = await this.partnerLedger.balances(tx, adjustment.partnerId);
      if (availableMinor < amountMinor) {
        const available = Money.of(Math.max(availableMinor, 0), adjustment.currency).format("en-GB");
        throw Errors.invalidTransition(`This partner has ${available} available, and their earnings can't go below zero.`);
      }
    }
    const { entry } = await this.partnerLedger.post(tx, adjustment.partnerId, {
      type: "ADJUSTMENT",
      bucket: "AVAILABLE",
      amountMinor: adjustment.direction === "CREDIT" ? amountMinor : -amountMinor,
      description: adjustment.reason,
      idempotencyKey: `adjustment:${adjustment.id}`,
      reference: { type: "partner_adjustment", id: adjustment.id },
      actorId: adjustment.requestedBy,
    });
    await tx.partnerAdjustment.update({ where: { id: adjustment.id }, data: { status: "APPLIED", decidedBy: approverId, decidedAt: new Date(), decisionNote: note, ledgerEntryId: entry.id } });
    await this.recordApplied(tx, principal, adjustment.id, entry.id, meta);
    return { partnerId: adjustment.partnerId, currency: adjustment.currency, direction: adjustment.direction, amountMinor, reason: adjustment.reason };
  }

  private async recordApplied(tx: Prisma.TransactionClient, principal: AuthPrincipal, adjustmentId: string, ledgerEntryId: string, meta: RequestMeta, vendorId?: string): Promise<void> {
    await this.audit.record(
      {
        actor: { userId: principal.userId, role: principal.role },
        action: "wallet_adjustment.applied",
        resourceType: "wallet_adjustment",
        resourceId: adjustmentId,
        ...(vendorId ? { vendorId } : {}),
        after: { ledgerEntryId },
        meta,
      },
      tx,
    );
  }

  private async askForApproval(adjustment: VendorAdjustmentRow | PartnerAdjustmentRow, currency: string, name: string, countryCode: string, account: "wallet" | "earnings"): Promise<void> {
    const amount = Money.of(Number(adjustment.amountMinor), currency).format("en-GB");
    const kind = adjustment.direction === "CREDIT" ? "credit" : "debit";
    await this.staffAlerts.raise("adjustments", {
      countryCode,
      title: `${amount} ${account} adjustment for ${name} to approve`,
      body: `${adjustment.requester.email} asked for a ${kind} because: ${adjustment.reason}`,
      exceptUserId: adjustment.requestedBy,
    });
  }

  private async followUpWallet(posting: PostingResult | null): Promise<void> {
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

  private async followUpPartner(posting: PartnerPosting | null): Promise<void> {
    if (!posting) {
      return;
    }
    const amount = Money.of(posting.amountMinor, posting.currency).format("en-GB");
    const email = posting.direction === "CREDIT" ? FinanceEmails.earningsCredited : FinanceEmails.earningsDebited;
    await this.partnerNotifier.notify(posting.partnerId, (to, webUrl) => email(to, amount, posting.reason, webUrl), "/admin/partnership/earnings");
  }
}
