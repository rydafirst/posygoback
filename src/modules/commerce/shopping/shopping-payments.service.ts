import { Inject, Injectable, type OnModuleInit } from "@nestjs/common";

import type { RequestMeta } from "../../../common/auth/auth-principal";
import { Errors } from "../../../common/http/app-exception";
import { APP_CONFIG } from "../../../config/config.module";
import type { AppConfig } from "../../../config/config.schema";
import { lockRow, PrismaService } from "../../../database/prisma.service";
import type { Prisma, ShoppingRequest } from "../../../generated/prisma/client";
import { AuditService, SYSTEM_ACTOR } from "../../../infrastructure/audit/audit.service";
import { EMAIL_SENDER, type EmailSender } from "../../../infrastructure/email/email.port";
import { AttemptLimiterService } from "../../../infrastructure/rate-limit/attempt-limiter.service";
import { Money, type ShoppingCheckoutInput, type ShoppingStartedView } from "../../../shared";
import { type OrderPaymentEvent, type OrderPaymentHandler, OrderPaymentRouter, type PaymentOutcome, type PaymentReversalEvent } from "../../finance/payments/order-payment.router";
import { PaymentAccountsService } from "../../finance/payments/payment-accounts.service";
import { PaymentEventsService } from "../../finance/payments/payment-events.service";
import { ShoppingEmails } from "./shopping-emails";
import { ShoppingRepository } from "./shopping.repository";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const PAYMENT_WINDOW_MS = 30 * 60 * 1000;
const PAYABLE = ["QUOTED", "EXPIRED"];
const STOPPABLE: string[] = ["PAID", "BUYING", "ARRIVED"];
const PER_BUYER = { name: "shopping-checkout", limit: 10, windowSeconds: 60 * 60 };

const outcome = (text: string, followUps: PaymentOutcome["followUps"] = []): PaymentOutcome => ({ outcome: text, followUps });

@Injectable()
export class ShoppingPaymentsService implements OrderPaymentHandler, OnModuleInit {
  constructor(
    private readonly prisma: PrismaService,
    private readonly router: OrderPaymentRouter,
    private readonly payments: PaymentAccountsService,
    private readonly events: PaymentEventsService,
    private readonly repository: ShoppingRepository,
    private readonly limiter: AttemptLimiterService,
    private readonly audit: AuditService,
    @Inject(EMAIL_SENDER) private readonly email: EmailSender,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  onModuleInit(): void {
    this.router.use("SHOPPING", this);
  }

  async start(buyerId: string, requestId: string, input: ShoppingCheckoutInput, meta: RequestMeta): Promise<ShoppingStartedView> {
    await this.limiter.consume(PER_BUYER, buyerId);
    const row = await this.prisma.shoppingRequest.findFirst({ where: { id: requestId, buyerId, confirmedAt: { not: null } }, include: { lines: true } });
    if (!row) {
      throw Errors.notFound();
    }
    if (row.status !== "QUOTED" || !row.quoteExpiresAt || row.quoteExpiresAt <= new Date()) {
      throw Errors.invalidTransition(row.status === "QUOTED" || row.status === "EXPIRED" ? "This price has run out. We'll send you a new one." : "This request isn't waiting for payment.");
    }
    if (!this.repository.parcel(row)?.options.some((candidate) => candidate.speed === input.deliverySpeed)) {
      throw Errors.validation({ deliverySpeed: ["Choose one of the delivery options"] });
    }
    const { processor } = this.payments.forCountry(row.countryCode);
    const totalMinor = await this.prisma.$transaction(async (tx) => {
      await lockRow(tx, "shoppingRequests", row.id);
      const current = await tx.shoppingRequest.findUniqueOrThrow({ where: { id: row.id } });
      const parcel = this.repository.parcel(current);
      const option = parcel?.options.find((candidate) => candidate.speed === input.deliverySpeed);
      if (current.status !== "QUOTED" || !option || !current.quoteExpiresAt || current.quoteExpiresAt <= new Date()) {
        throw Errors.invalidTransition("This price has just changed. Reload to see the new one.");
      }
      const total = Number(current.goodsMinor) + Number(current.commissionMinor) + option.priceMinor;
      await tx.shoppingRequest.update({
        where: { id: row.id },
        data: {
          deliveryMinor: BigInt(option.priceMinor),
          totalMinor: BigInt(total),
          parcel: { ...parcel, speed: option.speed } as unknown as Prisma.InputJsonValue,
          provider: processor.name,
          providerReference: null,
        },
      });
      await this.audit.record(
        {
          actor: SYSTEM_ACTOR,
          action: "shopping.checkout_started",
          resourceType: "shopping_request",
          resourceId: row.id,
          countryCode: row.countryCode,
          after: { totalMinor: total, speed: option.speed },
          meta,
        },
        tx,
      );
      return total;
    });
    const web = this.config.WEB_PUBLIC_URL;
    const session = await processor
      .createOrderCheckout({
        kind: "SHOPPING",
        orderId: row.id,
        reference: row.reference,
        storeName: "Personal shopping",
        currency: row.currency,
        totalMinor,
        itemCount: row.lines.filter((line) => line.status === "QUOTED").reduce((total, line) => total + line.quantity, 0),
        customerEmail: row.buyerEmail,
        successUrl: `${web}/account?paid=${row.reference}`,
        cancelUrl: `${web}/account`,
        expiresAt: new Date(Date.now() + PAYMENT_WINDOW_MS),
      })
      .catch(() => {
        throw Errors.carrierFailed("We couldn't start the payment. Try again in a moment.");
      });
    await this.prisma.shoppingRequest.update({ where: { id: row.id }, data: { providerReference: session.providerReference } });
    return { reference: row.reference, redirectUrl: session.redirectUrl };
  }

  async completeSandbox(buyerId: string, reference: string): Promise<void> {
    const row = await this.prisma.shoppingRequest.findFirst({ where: { reference, buyerId } });
    if (!row || row.provider !== "SANDBOX" || this.config.NODE_ENV === "production" || !row.providerReference) {
      throw Errors.notFound();
    }
    await this.events.handle("SANDBOX", row.countryCode, {
      kind: "ORDER_PAID",
      orderKind: "SHOPPING",
      eventId: `sandbox_shopping_paid_${row.id}`,
      orderId: row.id,
      providerReference: row.providerReference,
      paymentId: `sandbox_payment_${row.id}`,
      amountMinor: Number(row.totalMinor),
      currency: row.currency,
      type: "sandbox.order_paid",
      payload: { reference },
    });
  }

  async orderEvent(tx: Prisma.TransactionClient, provider: string, accountKey: string, event: OrderPaymentEvent): Promise<PaymentOutcome> {
    if (!UUID.test(event.orderId) || !(await lockRow(tx, "shoppingRequests", event.orderId))) {
      return outcome("unknown shopping request");
    }
    const row = await tx.shoppingRequest.findUniqueOrThrow({ where: { id: event.orderId } });
    if (event.kind === "ORDER_CLOSED") {
      return outcome("checkout closed");
    }
    if (row.provider !== provider || row.countryCode !== accountKey || row.providerReference !== event.providerReference) {
      await this.reject(tx, row, event.eventId, "checkout does not match");
      return outcome("rejected: checkout does not match", this.giveBack(accountKey, event));
    }
    if (row.currency !== event.currency || Number(row.totalMinor) !== event.amountMinor) {
      await this.reject(tx, row, event.eventId, "amount or currency does not match");
      return outcome("rejected: amount or currency does not match", this.giveBack(accountKey, event));
    }
    if (!PAYABLE.includes(row.status)) {
      if (row.paymentId === event.paymentId) {
        return outcome("already paid");
      }
      await this.reject(tx, row, event.eventId, row.paymentId ? "paid twice" : "request no longer payable");
      return outcome("rejected: not payable", this.giveBack(accountKey, event));
    }
    await tx.shoppingRequest.update({ where: { id: row.id }, data: { status: "PAID", paidAt: new Date(), paymentId: event.paymentId } });
    await this.audit.record(
      { actor: SYSTEM_ACTOR, action: "shopping.paid", resourceType: "shopping_request", resourceId: row.id, countryCode: row.countryCode, after: { totalMinor: event.amountMinor } },
      tx,
    );
    const total = Money.of(event.amountMinor, row.currency).format("en-GB");
    return outcome("paid", [() => this.email.send(ShoppingEmails.paid(row.buyerEmail, row.reference, total, this.config.WEB_PUBLIC_URL)).then(() => undefined)]);
  }

  async paymentReversal(tx: Prisma.TransactionClient, provider: string, accountKey: string, event: PaymentReversalEvent): Promise<PaymentOutcome | null> {
    const match = event.paymentId ? await tx.shoppingRequest.findFirst({ where: { provider, countryCode: accountKey, paymentId: event.paymentId }, select: { id: true } }) : null;
    if (!match) {
      return null;
    }
    await lockRow(tx, "shoppingRequests", match.id);
    const row = await tx.shoppingRequest.findUniqueOrThrow({ where: { id: match.id } });
    const refundedTotal = event.kind === "PAYMENT_REFUNDED" ? event.refundedTotalMinor : event.stage === "LOST" ? Number(row.refundedMinor) + event.amountMinor : Number(row.refundedMinor);
    const capped = Math.min(refundedTotal, Number(row.totalMinor));
    const fullyRefunded = capped >= Number(row.totalMinor) && STOPPABLE.includes(row.status);
    await tx.shoppingRequest.update({
      where: { id: row.id },
      data: {
        refundedMinor: BigInt(Math.max(capped, Number(row.refundedMinor))),
        disputeOpen: event.kind === "PAYMENT_DISPUTED" ? event.stage === "OPENED" : row.disputeOpen,
        ...(fullyRefunded ? { status: "CANCELLED", cancelReason: "The payment was returned through the card provider." } : {}),
      },
    });
    const action = event.kind === "PAYMENT_REFUNDED" ? "shopping.refund_seen" : `shopping.dispute_${event.stage.toLowerCase()}`;
    await this.audit.record(
      { actor: SYSTEM_ACTOR, action, resourceType: "shopping_request", resourceId: row.id, countryCode: row.countryCode, after: { refundedMinor: capped, stopped: fullyRefunded } },
      tx,
    );
    return outcome(action);
  }

  private giveBack(accountKey: string, event: OrderPaymentEvent): PaymentOutcome["followUps"] {
    if (event.kind !== "ORDER_PAID") {
      return [];
    }
    return [
      async () => {
        await this.payments.forCountry(accountKey).processor.refund({ paymentId: event.paymentId, amountMinor: event.amountMinor, idempotencyKey: `shopping-stray:${event.paymentId}` });
      },
    ];
  }

  private async reject(tx: Prisma.TransactionClient, row: ShoppingRequest, eventId: string, reason: string): Promise<void> {
    await this.audit.record({ actor: SYSTEM_ACTOR, action: "payment.rejected", resourceType: "shopping_request", resourceId: row.id, countryCode: row.countryCode, after: { reason, eventId } }, tx);
  }
}
