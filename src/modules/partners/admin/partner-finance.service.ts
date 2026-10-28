import { Inject, Injectable, Logger } from "@nestjs/common";

import type { AuthPrincipal, RequestMeta } from "../../../common/auth/auth-principal";
import { Errors } from "../../../common/http/app-exception";
import { lockRow, PrismaService } from "../../../database/prisma.service";
import { AuditService, SYSTEM_ACTOR } from "../../../infrastructure/audit/audit.service";
import { Money, type PartnerPayoutView } from "../../../shared";
import { StaffAlertsService } from "../../notifications/staff-alerts.service";
import { PartnerLedgerService } from "../ledger/partner-ledger.service";
import { PartnerEmails } from "../partner-emails";
import { PartnerNotifierService } from "../partner-notifier.service";
import { PAYOUT_GATEWAY, type PayoutGateway, TransferError } from "../providers/partner-services.port";
import { actorOf, adminPartnerScope, AdminPartnersService } from "./admin-partners.service";

const PAYOUT_INCLUDE = { partner: { select: { legalName: true } }, requester: { select: { email: true } }, decider: { select: { email: true } } } as const;

const RETRY_WINDOW_HOURS = 20;

export function retryCutoff(): Date {
  return new Date(Date.now() - RETRY_WINDOW_HOURS * 60 * 60 * 1000);
}

@Injectable()
export class PartnerFinanceService {
  private readonly logger = new Logger(PartnerFinanceService.name);

  constructor(
    @Inject(PAYOUT_GATEWAY) private readonly gateway: PayoutGateway,
    private readonly prisma: PrismaService,
    private readonly admin: AdminPartnersService,
    private readonly ledger: PartnerLedgerService,
    private readonly notifier: PartnerNotifierService,
    private readonly audit: AuditService,
    private readonly staffAlerts: StaffAlertsService,
  ) {}

  async requestPayout(principal: AuthPrincipal, partnerId: string, input: { amountMinor: number; note: string }, meta: RequestMeta): Promise<PartnerPayoutView> {
    const partner = await this.admin.scoped(principal, partnerId);
    const currency = await this.currency(partner.countryCode);
    const payout = await this.prisma.$transaction(async (tx) => {
      await lockRow(tx, "fulfilmentPartners", partnerId);
      const account = await tx.partnerPayoutAccount.findUnique({ where: { partnerId }, select: { status: true } });
      if (account?.status !== "ACTIVE") {
        throw Errors.invalidTransition("The partner hasn't finished setting up payouts.");
      }
      if (await tx.partnerPayout.findFirst({ where: { partnerId, status: { in: ["PENDING_APPROVAL", "PROCESSING"] } }, select: { id: true } })) {
        throw Errors.invalidTransition("A payout is already waiting or being sent.");
      }
      const { availableMinor } = await this.ledger.balances(tx, partnerId);
      if (input.amountMinor > availableMinor) {
        throw Errors.validation({ amountMinor: [`Only ${Money.of(availableMinor, currency).format("en-GB")} is available`] });
      }
      const created = await tx.partnerPayout.create({
        data: { partnerId, amountMinor: BigInt(input.amountMinor), currency, note: input.note, requestedBy: principal.userId },
        include: PAYOUT_INCLUDE,
      });
      await this.audit.record(
        {
          actor: actorOf(principal),
          action: "partner.payout_requested",
          resourceType: "partner_payout",
          resourceId: created.id,
          countryCode: partner.countryCode,
          after: { amountMinor: input.amountMinor },
          meta,
        },
        tx,
      );
      return created;
    });
    await this.staffAlerts.raise("partnerPayouts", {
      countryCode: partner.countryCode,
      title: `${Money.of(Number(payout.amountMinor), payout.currency).format("en-GB")} payout for ${payout.partner.legalName} to approve`,
      body: `${payout.requester.email} asked to pay this partner and it needs someone else to approve it.`,
      exceptUserId: principal.userId,
    });
    return this.toPayoutView(payout);
  }

  async decidePayout(principal: AuthPrincipal, payoutId: string, input: { approve: boolean; note: string }, meta: RequestMeta): Promise<PartnerPayoutView> {
    const existing = await this.prisma.partnerPayout.findFirst({ where: { id: payoutId, partner: adminPartnerScope(principal) }, select: { partnerId: true } });
    if (!existing) {
      throw Errors.notFound();
    }
    await this.prisma.$transaction(async (tx) => {
      await lockRow(tx, "fulfilmentPartners", existing.partnerId);
      await lockRow(tx, "partnerPayouts", payoutId);
      const payout = await tx.partnerPayout.findUniqueOrThrow({ where: { id: payoutId }, include: { partner: { select: { countryCode: true } } } });
      if (payout.status !== "PENDING_APPROVAL") {
        throw Errors.invalidTransition("This payout has already been decided.");
      }
      if (payout.requestedBy === principal.userId) {
        throw Errors.secondPersonRequired("Someone else must approve a payout you requested.");
      }
      if (input.approve) {
        const account = await tx.partnerPayoutAccount.findUnique({ where: { partnerId: payout.partnerId }, select: { status: true, detailsChangedAt: true } });
        if (account?.status !== "ACTIVE" || (account.detailsChangedAt && account.detailsChangedAt > payout.createdAt)) {
          throw Errors.invalidTransition("The partner's bank details changed after this request. Reject it and request again.");
        }
        await this.ledger.post(tx, payout.partnerId, {
          type: "PAYOUT",
          bucket: "AVAILABLE",
          amountMinor: -Number(payout.amountMinor),
          description: "Payout to bank account",
          idempotencyKey: `payout:${payout.id}`,
          reference: { type: "partner_payout", id: payout.id },
          actorId: principal.userId,
        });
      }
      await tx.partnerPayout.update({
        where: { id: payoutId },
        data: { status: input.approve ? "PROCESSING" : "REJECTED", decidedBy: principal.userId, decidedAt: new Date(), decisionNote: input.note },
      });
      await this.audit.record(
        {
          actor: actorOf(principal),
          action: input.approve ? "partner.payout_approved" : "partner.payout_rejected",
          resourceType: "partner_payout",
          resourceId: payoutId,
          countryCode: payout.partner.countryCode,
          after: { note: input.note },
          meta,
        },
        tx,
      );
    });
    if (input.approve) {
      await this.send(payoutId);
    }
    return this.payoutView(payoutId);
  }

  async retryPayout(principal: AuthPrincipal, payoutId: string): Promise<PartnerPayoutView> {
    const payout = await this.prisma.partnerPayout.findFirst({ where: { id: payoutId, partner: adminPartnerScope(principal) }, select: { status: true, decidedAt: true } });
    if (!payout) {
      throw Errors.notFound();
    }
    if (payout.status !== "PROCESSING") {
      throw Errors.invalidTransition("Only a payout that's still being sent can be retried.");
    }
    if (!payout.decidedAt || payout.decidedAt < retryCutoff()) {
      throw Errors.invalidTransition("This payout is too old to send again safely. Check the payment provider's dashboard and settle it there.");
    }
    await this.send(payoutId);
    return this.payoutView(payoutId);
  }

  async send(payoutId: string): Promise<void> {
    const payout = await this.prisma.partnerPayout.findUniqueOrThrow({
      where: { id: payoutId },
      include: { partner: { select: { status: true, payoutAccount: { select: { providerAccountId: true, status: true, detailsChangedAt: true } } } } },
    });
    const account = payout.partner.payoutAccount;
    if (payout.status !== "PROCESSING" || !account) {
      return;
    }
    if (account.status !== "ACTIVE" || (account.detailsChangedAt && account.detailsChangedAt > payout.createdAt) || payout.partner.status === "TERMINATED") {
      await this.fail(payout, "The payout account changed or was closed after approval");
      return;
    }
    try {
      const transferId = await this.gateway.transfer({
        accountId: account.providerAccountId,
        amountMinor: Number(payout.amountMinor),
        currency: payout.currency,
        idempotencyKey: `payout:${payout.id}`,
      });
      const paid = await this.prisma.partnerPayout.updateMany({ where: { id: payoutId, status: "PROCESSING" }, data: { status: "PAID", providerTransferId: transferId } });
      if (paid.count > 0) {
        await this.audit.record({ actor: SYSTEM_ACTOR, action: "partner.payout_paid", resourceType: "partner_payout", resourceId: payoutId, after: { transferId } });
        const amount = Money.of(Number(payout.amountMinor), payout.currency).format("en-GB");
        await this.notifier.notify(payout.partnerId, (to, webUrl) => PartnerEmails.payoutPaid(to, amount, webUrl));
      }
    } catch (error) {
      if (!(error instanceof TransferError) || !error.definite) {
        this.logger.warn(`Payout ${payoutId} not confirmed yet: ${String(error)}`);
        return;
      }
      await this.fail(payout, error.message);
    }
  }

  private async fail(payout: { id: string; partnerId: string; amountMinor: bigint; currency: string }, reason: string): Promise<void> {
    const failed = await this.prisma.$transaction(async (tx) => {
      await lockRow(tx, "partnerPayouts", payout.id);
      const updated = await tx.partnerPayout.updateMany({ where: { id: payout.id, status: "PROCESSING" }, data: { status: "FAILED", failureReason: reason.slice(0, 300) } });
      if (updated.count === 0) {
        return false;
      }
      await this.ledger.post(tx, payout.partnerId, {
        type: "PAYOUT",
        bucket: "AVAILABLE",
        amountMinor: Number(payout.amountMinor),
        description: "Payout returned: the transfer failed",
        idempotencyKey: `payout:${payout.id}:returned`,
        reference: { type: "partner_payout", id: payout.id },
      });
      await this.audit.record({ actor: SYSTEM_ACTOR, action: "partner.payout_failed", resourceType: "partner_payout", resourceId: payout.id, after: { reason } }, tx);
      return true;
    });
    if (failed) {
      const amount = Money.of(Number(payout.amountMinor), payout.currency).format("en-GB");
      await this.notifier.notify(payout.partnerId, (to, webUrl) => PartnerEmails.payoutFailed(to, amount, webUrl));
    }
  }

  async payouts(principal: AuthPrincipal, status?: PartnerPayoutView["status"]): Promise<PartnerPayoutView[]> {
    const rows = await this.prisma.partnerPayout.findMany({
      where: { partner: adminPartnerScope(principal), ...(status ? { status } : {}) },
      include: PAYOUT_INCLUDE,
      orderBy: { createdAt: "desc" },
      take: 200,
    });
    return rows.map((row) => this.toPayoutView(row));
  }

  private async payoutView(payoutId: string): Promise<PartnerPayoutView> {
    return this.toPayoutView(await this.prisma.partnerPayout.findUniqueOrThrow({ where: { id: payoutId }, include: PAYOUT_INCLUDE }));
  }

  private async currency(countryCode: string): Promise<string> {
    return (await this.prisma.country.findUniqueOrThrow({ where: { code: countryCode }, select: { currency: true } })).currency;
  }

  private toPayoutView(row: {
    id: string;
    partnerId: string;
    amountMinor: bigint;
    currency: string;
    status: PartnerPayoutView["status"];
    note: string;
    failureReason: string | null;
    createdAt: Date;
    partner: { legalName: string };
    requester: { email: string };
    decider: { email: string } | null;
  }): PartnerPayoutView {
    return {
      id: row.id,
      partnerId: row.partnerId,
      legalName: row.partner.legalName,
      amountMinor: Number(row.amountMinor),
      currency: row.currency,
      status: row.status,
      note: row.note,
      failureReason: row.failureReason,
      requestedByEmail: row.requester.email,
      decidedByEmail: row.decider?.email ?? null,
      createdAt: row.createdAt.toISOString(),
    };
  }
}
