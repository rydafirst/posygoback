import { Injectable, Logger } from "@nestjs/common";

import { isUniqueViolation, lockRow, PrismaService } from "../../../database/prisma.service";
import type { Prisma, TopUp } from "../../../generated/prisma/client";
import { AuditService, SYSTEM_ACTOR } from "../../../infrastructure/audit/audit.service";
import { Money } from "../../../shared";
import { FinanceEmails } from "../finance-emails";
import { WalletAlertsService } from "../wallets/wallet-alerts.service";
import { WalletLedgerService } from "../wallets/wallet-ledger.service";
import { OrderPaymentRouter, type PaymentOutcome } from "./order-payment.router";
import { type DisputeStage, type PaymentEvent, PaymentEventNotReady } from "./payment-processor.port";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

type ParsedEvent = PaymentEvent & { type: string; payload: unknown };
type FollowUp = () => Promise<void>;
type Outcome = PaymentOutcome;

function netShare(topUp: TopUp, grossMinor: number): number {
  const gross = Number(topUp.grossMinor);
  const net = Number(topUp.netMinor);
  return grossMinor >= gross ? net : Math.floor((grossMinor * net) / gross);
}

@Injectable()
export class PaymentEventsService {
  private readonly logger = new Logger(PaymentEventsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly ledger: WalletLedgerService,
    private readonly alerts: WalletAlertsService,
    private readonly orders: OrderPaymentRouter,
    private readonly audit: AuditService,
  ) {}

  async handle(provider: string, accountKey: string, event: ParsedEvent): Promise<string> {
    let result: Outcome;
    try {
      result = await this.prisma.$transaction(async (tx) => {
        const stored = await tx.paymentEvent.create({ data: { provider, accountKey, eventId: event.eventId, type: event.type, payload: event.payload as Prisma.InputJsonValue } });
        const processed = await this.process(tx, provider, accountKey, event);
        await tx.paymentEvent.update({ where: { id: stored.id }, data: { processedAt: new Date(), outcome: processed.outcome.slice(0, 300) } });
        return processed;
      });
    } catch (error) {
      if (isUniqueViolation(error)) {
        return "duplicate";
      }
      throw error;
    }
    for (const followUp of result.followUps) {
      await followUp().catch((error: unknown) => this.logger.error(`Payment follow-up failed: ${String(error)}`));
    }
    return result.outcome;
  }

  private async process(tx: Prisma.TransactionClient, provider: string, accountKey: string, event: ParsedEvent): Promise<Outcome> {
    if (event.kind === "PAYMENT_REFUNDED" || event.kind === "PAYMENT_DISPUTED") {
      for (const handler of this.orders.all()) {
        const routed = await handler.paymentReversal(tx, provider, accountKey, event);
        if (routed) {
          return routed;
        }
      }
    }
    switch (event.kind) {
      case "ORDER_PAID":
      case "ORDER_CLOSED":
        return this.orders.for(event.orderKind)?.orderEvent(tx, provider, accountKey, event) ?? { outcome: "no order handler", followUps: [] };
      case "TOP_UP_PAID":
        return this.paid(tx, provider, accountKey, event);
      case "TOP_UP_CLOSED":
        return this.closed(tx, provider, accountKey, event);
      case "PAYMENT_REFUNDED":
        return this.reversed(tx, provider, accountKey, event.paymentId, event.currency, () => event.refundedTotalMinor, `refund:${event.refundedTotalMinor}`, "Card payment refunded");
      case "PAYMENT_DISPUTED":
        return this.disputed(tx, provider, accountKey, event, event.stage);
      default:
        return { outcome: `ignored ${event.type}`, followUps: [] };
    }
  }

  private async paid(tx: Prisma.TransactionClient, provider: string, accountKey: string, event: Extract<PaymentEvent, { kind: "TOP_UP_PAID" }>): Promise<Outcome> {
    const topUp = UUID.test(event.topUpId) && (await lockRow(tx, "topUps", event.topUpId)) ? await tx.topUp.findUnique({ where: { id: event.topUpId } }) : null;
    const problem = !topUp
      ? "unknown top-up"
      : topUp.processor !== provider || topUp.countryCode !== accountKey
        ? "paid into the wrong account"
        : topUp.providerReference !== event.providerReference
          ? "checkout session does not match"
          : topUp.currency !== event.currency || Number(topUp.grossMinor) !== event.amountMinor
            ? "amount or currency does not match"
            : null;
    if (problem || !topUp) {
      await this.audit.record({ actor: SYSTEM_ACTOR, action: "payment.rejected", resourceType: "top_up", resourceId: event.topUpId || null, after: { reason: problem, eventId: event.eventId } }, tx);
      return { outcome: `rejected: ${problem}`, followUps: [] };
    }
    if (topUp.status !== "PENDING") {
      return { outcome: "already settled", followUps: [] };
    }
    const result = await this.ledger.post(tx, topUp.walletId, {
      type: "DEPOSIT",
      amountMinor: Number(topUp.netMinor),
      description: "Wallet top-up",
      idempotencyKey: `top-up:${topUp.id}`,
      reference: { type: "top_up", id: topUp.id },
    });
    await tx.topUp.update({ where: { id: topUp.id }, data: { status: "SUCCEEDED", completedAt: new Date(), providerPaymentId: event.paymentId } });
    if (result.wallet.status === "STORAGE_OVERDUE") {
      await tx.wallet.update({ where: { id: topUp.walletId }, data: { status: "ACTIVE", overdueSince: null } });
    }
    await this.audit.record(
      {
        actor: SYSTEM_ACTOR,
        action: "top_up.credited",
        resourceType: "top_up",
        resourceId: topUp.id,
        vendorId: topUp.vendorId,
        countryCode: topUp.countryCode,
        after: { netMinor: Number(topUp.netMinor) },
      },
      tx,
    );
    const amount = Money.of(Number(topUp.netMinor), topUp.currency).format("en-GB");
    return { outcome: "credited", followUps: [() => this.alerts.notifyOwner(topUp.vendorId, (to) => FinanceEmails.topUpReceived(to, amount), "/wallet")] };
  }

  private async closed(tx: Prisma.TransactionClient, provider: string, accountKey: string, event: Extract<PaymentEvent, { kind: "TOP_UP_CLOSED" }>): Promise<Outcome> {
    if (!UUID.test(event.topUpId)) {
      return { outcome: "unknown top-up", followUps: [] };
    }
    const updated = await tx.topUp.updateMany({
      where: { id: event.topUpId, processor: provider, countryCode: accountKey, providerReference: event.providerReference, status: "PENDING" },
      data: { status: event.outcome, completedAt: new Date() },
    });
    return { outcome: updated.count > 0 ? event.outcome.toLowerCase() : "nothing to close", followUps: [] };
  }

  private async reversed(
    tx: Prisma.TransactionClient,
    provider: string,
    accountKey: string,
    paymentId: string,
    currency: string,
    reversedTotal: (previousMinor: number) => number,
    keySuffix: string,
    description: string,
  ): Promise<Outcome> {
    const topUp = await this.matchedPayment(tx, provider, accountKey, paymentId);
    if (topUp.currency !== currency) {
      return { outcome: "currency does not match", followUps: [] };
    }
    const previous = Number(topUp.refundedMinor);
    const total = Math.min(reversedTotal(previous), Number(topUp.grossMinor));
    const due = netShare(topUp, total) - netShare(topUp, previous);
    if (due <= 0) {
      return { outcome: "nothing new to reverse", followUps: [] };
    }
    const wallet = await tx.wallet.findUniqueOrThrow({ where: { id: topUp.walletId } });
    const recoverable = Math.min(due, Number(wallet.balanceMinor));
    if (recoverable > 0) {
      await this.ledger.post(tx, wallet.id, {
        type: "PAYMENT_REVERSAL",
        amountMinor: recoverable,
        description,
        idempotencyKey: `top-up:${topUp.id}:${keySuffix}`,
        reference: { type: "top_up", id: topUp.id },
      });
    }
    await tx.topUp.update({ where: { id: topUp.id }, data: { refundedMinor: BigInt(total), status: total >= Number(topUp.grossMinor) ? "REFUNDED" : topUp.status } });
    const shortfall = due - recoverable;
    const followUps: FollowUp[] = [];
    if (shortfall > 0) {
      await this.freeze(tx, wallet.id, topUp, { reason: description, shortfallMinor: shortfall });
      followUps.push(() => this.alerts.notifyOwner(topUp.vendorId, FinanceEmails.walletFrozen, "/wallet"));
    }
    return { outcome: shortfall > 0 ? `reversed ${recoverable}, short ${shortfall}` : `reversed ${recoverable}`, followUps };
  }

  private async disputed(tx: Prisma.TransactionClient, provider: string, accountKey: string, event: Extract<PaymentEvent, { kind: "PAYMENT_DISPUTED" }>, stage: DisputeStage): Promise<Outcome> {
    if (stage === "LOST") {
      return this.reversed(tx, provider, accountKey, event.paymentId, event.currency, (previous) => previous + event.amountMinor, `dispute:${event.eventId}`, "Card payment disputed and lost");
    }
    const topUp = await this.matchedPayment(tx, provider, accountKey, event.paymentId);
    if (stage === "WON") {
      await this.audit.record(
        {
          actor: SYSTEM_ACTOR,
          action: "payment.dispute_won",
          resourceType: "wallet",
          resourceId: topUp.walletId,
          vendorId: topUp.vendorId,
          countryCode: topUp.countryCode,
          after: { topUpId: topUp.id },
        },
        tx,
      );
      return { outcome: "dispute won, wallet left for finance to review", followUps: [] };
    }
    await this.freeze(tx, topUp.walletId, topUp, { reason: "Card payment disputed" });
    return { outcome: "wallet frozen pending dispute", followUps: [() => this.alerts.notifyOwner(topUp.vendorId, FinanceEmails.walletFrozen, "/wallet")] };
  }

  private async matchedPayment(tx: Prisma.TransactionClient, provider: string, accountKey: string, paymentId: string): Promise<TopUp> {
    const candidate = paymentId ? await tx.topUp.findFirst({ where: { providerPaymentId: paymentId, processor: provider, countryCode: accountKey }, select: { id: true } }) : null;
    if (!candidate) {
      throw new PaymentEventNotReady("No settled top-up matches this payment yet");
    }
    await lockRow(tx, "topUps", candidate.id);
    return tx.topUp.findUniqueOrThrow({ where: { id: candidate.id } });
  }

  private async freeze(tx: Prisma.TransactionClient, walletId: string, topUp: TopUp, details: Record<string, unknown>): Promise<void> {
    await tx.wallet.update({ where: { id: walletId }, data: { status: "FROZEN" } });
    await this.audit.record(
      {
        actor: SYSTEM_ACTOR,
        action: "wallet.frozen",
        resourceType: "wallet",
        resourceId: walletId,
        vendorId: topUp.vendorId,
        countryCode: topUp.countryCode,
        after: { ...details, topUpId: topUp.id },
      },
      tx,
    );
  }
}
