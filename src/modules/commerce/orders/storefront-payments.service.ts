import { Injectable, type OnModuleInit } from "@nestjs/common";

import { lockRow } from "../../../database/prisma.service";
import type { Prisma, StorefrontOrder } from "../../../generated/prisma/client";
import { AuditService, SYSTEM_ACTOR } from "../../../infrastructure/audit/audit.service";
import { PaymentAccountsService } from "../../finance/payments/payment-accounts.service";
import { type OrderPaymentEvent, type OrderPaymentHandler, OrderPaymentRouter, type PaymentOutcome, type PaymentReversalEvent } from "../../finance/payments/order-payment.router";
import { WalletAlertsService } from "../../finance/wallets/wallet-alerts.service";
import { CommerceEmails } from "../commerce-emails";
import { DiscountsService } from "../checkout/discounts.service";
import { StorefrontFulfilmentService } from "./storefront-fulfilment.service";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const PAYABLE = ["PENDING_PAYMENT", "CANCELLED", "PAYMENT_FAILED"];

const outcome = (text: string, followUps: PaymentOutcome["followUps"] = []): PaymentOutcome => ({ outcome: text, followUps });

@Injectable()
export class StorefrontPaymentsService implements OrderPaymentHandler, OnModuleInit {
  constructor(
    private readonly router: OrderPaymentRouter,
    private readonly discounts: DiscountsService,
    private readonly payments: PaymentAccountsService,
    private readonly fulfilment: StorefrontFulfilmentService,
    private readonly owners: WalletAlertsService,
    private readonly audit: AuditService,
  ) {}

  onModuleInit(): void {
    this.router.use("STORE", this);
  }

  async orderEvent(tx: Prisma.TransactionClient, provider: string, accountKey: string, event: OrderPaymentEvent): Promise<PaymentOutcome> {
    if (!UUID.test(event.orderId) || !(await lockRow(tx, "storefrontOrders", event.orderId))) {
      return outcome("unknown storefront order");
    }
    const order = await tx.storefrontOrder.findUniqueOrThrow({ where: { id: event.orderId } });
    if (order.provider !== provider || order.countryCode !== accountKey || order.providerReference !== event.providerReference) {
      await this.reject(tx, order, event.eventId, "checkout does not match");
      return outcome("rejected: checkout does not match", this.giveBack(accountKey, event));
    }
    if (event.kind === "ORDER_CLOSED") {
      const closed = await tx.storefrontOrder.updateMany({ where: { id: order.id, status: "PENDING_PAYMENT" }, data: { status: event.outcome === "EXPIRED" ? "CANCELLED" : "PAYMENT_FAILED" } });
      if (closed.count > 0 && order.discountCodeId) {
        await this.discounts.release(tx, order.discountCodeId);
      }
      return outcome(closed.count > 0 ? event.outcome.toLowerCase() : "nothing to close");
    }
    if (order.currency !== event.currency || Number(order.totalMinor) !== event.amountMinor) {
      await this.reject(tx, order, event.eventId, "amount or currency does not match");
      return outcome("rejected: amount or currency does not match", this.giveBack(accountKey, event));
    }
    if (!PAYABLE.includes(order.status)) {
      if (order.paymentId === event.paymentId) {
        return outcome("already paid");
      }
      await this.reject(tx, order, event.eventId, "paid twice");
      return outcome("rejected: paid twice", this.giveBack(accountKey, event));
    }
    await tx.storefrontOrder.update({ where: { id: order.id }, data: { status: "PAID", paidAt: new Date(), paymentId: event.paymentId, payoutStatus: "HELD" } });
    if (order.discountCodeId && order.status !== "PENDING_PAYMENT" && !(await this.discounts.redeem(tx, order.discountCodeId))) {
      await this.reject(tx, order, event.eventId, "discount code was used up while the checkout was closed; payment kept");
    }
    await this.audit.record(
      {
        actor: SYSTEM_ACTOR,
        action: "storefront.order_paid",
        resourceType: "storefront_order",
        resourceId: order.id,
        vendorId: order.vendorId,
        countryCode: order.countryCode,
        after: { totalMinor: event.amountMinor },
      },
      tx,
    );
    return outcome("paid", [() => this.fulfilment.afterPayment(order.id)]);
  }

  async paymentReversal(tx: Prisma.TransactionClient, provider: string, accountKey: string, event: PaymentReversalEvent): Promise<PaymentOutcome | null> {
    const match = event.paymentId ? await tx.storefrontOrder.findFirst({ where: { provider, countryCode: accountKey, paymentId: event.paymentId }, select: { id: true } }) : null;
    if (!match) {
      return null;
    }
    await lockRow(tx, "storefrontOrders", match.id);
    const order = await tx.storefrontOrder.findUniqueOrThrow({ where: { id: match.id } });
    if (event.kind === "PAYMENT_REFUNDED") {
      return this.refunded(tx, order, Math.min(event.refundedTotalMinor, Number(order.totalMinor)));
    }
    await tx.storefrontOrder.update({ where: { id: order.id }, data: { disputeOpen: event.stage === "OPENED" } });
    if (event.stage === "LOST") {
      await this.refunded(tx, order, Math.min(Number(order.refundedMinor) + event.amountMinor, Number(order.totalMinor)));
    }
    await this.audit.record(
      {
        actor: SYSTEM_ACTOR,
        action: `storefront.dispute_${event.stage.toLowerCase()}`,
        resourceType: "storefront_order",
        resourceId: order.id,
        vendorId: order.vendorId,
        countryCode: order.countryCode,
      },
      tx,
    );
    return outcome(`dispute ${event.stage.toLowerCase()}`, [() => this.tellVendorAboutDispute(order, event.stage === "OPENED" ? null : event.stage === "WON")]);
  }

  private async tellVendorAboutDispute(order: StorefrontOrder, won: boolean | null): Promise<void> {
    const held = order.payoutStatus !== "PAID";
    await this.owners
      .notifyOwner(
        order.vendorId,
        (to, webUrl) => (won === null ? CommerceEmails.paymentDisputed(to, order.reference, held, webUrl) : CommerceEmails.disputeClosed(to, order.reference, won, webUrl)),
        "/storefront",
      )
      .catch(() => undefined);
  }

  private async refunded(tx: Prisma.TransactionClient, order: StorefrontOrder, refundedTotal: number): Promise<PaymentOutcome> {
    if (refundedTotal <= Number(order.refundedMinor)) {
      return outcome("nothing new refunded");
    }
    const full = refundedTotal >= Number(order.totalMinor);
    const payoutAlreadyPaid = order.payoutStatus === "PAID";
    await tx.storefrontOrder.update({
      where: { id: order.id },
      data: {
        refundedMinor: BigInt(refundedTotal),
        status: full ? "REFUNDED" : order.status,
        payoutStatus: full && ["HELD", "PENDING", "FAILED"].includes(order.payoutStatus) ? "CANCELLED" : order.payoutStatus,
      },
    });
    await this.audit.record(
      {
        actor: SYSTEM_ACTOR,
        action: payoutAlreadyPaid ? "storefront.refunded_after_payout" : "storefront.order_refunded",
        resourceType: "storefront_order",
        resourceId: order.id,
        vendorId: order.vendorId,
        countryCode: order.countryCode,
        after: { refundedMinor: refundedTotal },
      },
      tx,
    );
    return outcome(payoutAlreadyPaid ? "refunded after payout, needs recovery" : "refunded");
  }

  private giveBack(accountKey: string, event: OrderPaymentEvent): PaymentOutcome["followUps"] {
    if (event.kind !== "ORDER_PAID") {
      return [];
    }
    return [
      async () => {
        await this.payments.forCountry(accountKey).processor.refund({ paymentId: event.paymentId, amountMinor: event.amountMinor, idempotencyKey: `storefront-stray:${event.paymentId}` });
      },
    ];
  }

  private async reject(tx: Prisma.TransactionClient, order: StorefrontOrder, eventId: string, reason: string): Promise<void> {
    await this.audit.record({ actor: SYSTEM_ACTOR, action: "payment.rejected", resourceType: "storefront_order", resourceId: order.id, vendorId: order.vendorId, after: { reason, eventId } }, tx);
  }
}
