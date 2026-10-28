import Stripe from "stripe";

import type { ActivationCheckoutRequest, CheckoutRequest, CheckoutSession, OrderCheckoutRequest, OrderKind, PaymentEvent, PaymentProcessor, RefundRequest } from "./payment-processor.port";
import { WebhookSignatureError } from "./payment-processor.port";

const TOLERANCE_SECONDS = 300;
const ORDER_PURPOSE = "storefront.order";
const ORDER_KINDS: readonly OrderKind[] = ["STORE", "SHOPPING", "ACTIVATION"];
const CHECKOUT_WINDOW_SECONDS = 60 * 60;

type ParsedEvent = PaymentEvent & { type: string; payload: unknown };

function orderKindOf(metadata: Stripe.Metadata | null | undefined): OrderKind {
  return ORDER_KINDS.find((kind) => kind === metadata?.orderKind) ?? "STORE";
}

export class StripeProcessor implements PaymentProcessor {
  readonly name = "STRIPE";
  private readonly client: Stripe;

  constructor(
    secretKey: string,
    private readonly webhookSecret: string,
  ) {
    this.client = new Stripe(secretKey, { maxNetworkRetries: 2, timeout: 20_000 });
  }

  async createCheckout(request: CheckoutRequest): Promise<CheckoutSession> {
    const session = await this.client.checkout.sessions.create(
      {
        mode: "payment",
        customer_email: request.customerEmail,
        client_reference_id: request.topUpId,
        line_items: [{ quantity: 1, price_data: { currency: request.currency.toLowerCase(), unit_amount: request.grossMinor, product_data: { name: request.description } } }],
        metadata: { topUpId: request.topUpId, purpose: "wallet.top_up" },
        payment_intent_data: { metadata: { topUpId: request.topUpId, purpose: "wallet.top_up" } },
        success_url: request.successUrl,
        cancel_url: request.cancelUrl,
        expires_at: Math.floor(Date.now() / 1000) + CHECKOUT_WINDOW_SECONDS,
      },
      { idempotencyKey: `top-up:${request.topUpId}` },
    );
    if (!session.url) {
      throw new Error("Stripe did not return a checkout link");
    }
    return { providerReference: session.id, redirectUrl: session.url };
  }

  async createOrderCheckout(request: OrderCheckoutRequest): Promise<CheckoutSession> {
    const metadata = { orderId: request.orderId, orderKind: request.kind, purpose: ORDER_PURPOSE };
    const session = await this.client.checkout.sessions.create(
      {
        mode: "payment",
        customer_email: request.customerEmail,
        client_reference_id: request.orderId,
        line_items: [
          {
            quantity: 1,
            price_data: {
              currency: request.currency.toLowerCase(),
              unit_amount: request.totalMinor,
              product_data: { name: `${request.storeName} · order ${request.reference}`, description: `${request.itemCount} ${request.itemCount === 1 ? "item" : "items"} with delivery` },
            },
          },
        ],
        metadata,
        payment_intent_data: { metadata },
        success_url: request.successUrl,
        cancel_url: request.cancelUrl,
        expires_at: Math.floor(request.expiresAt.getTime() / 1000),
      },
      { idempotencyKey: `${request.kind === "STORE" ? "storefront-order" : "shopping-order"}:${request.orderId}` },
    );
    if (!session.url) {
      throw new Error("Stripe did not return a checkout link");
    }
    return { providerReference: session.id, redirectUrl: session.url };
  }

  async createActivationCheckout(request: ActivationCheckoutRequest): Promise<CheckoutSession> {
    const metadata = { orderId: request.paymentId, orderKind: "ACTIVATION", purpose: ORDER_PURPOSE };
    const session = await this.client.checkout.sessions.create(
      {
        mode: "payment",
        customer_email: request.customerEmail,
        client_reference_id: request.paymentId,
        line_items: [{ quantity: 1, price_data: { currency: request.currency.toLowerCase(), unit_amount: request.amountMinor, product_data: { name: request.description } } }],
        metadata,
        payment_intent_data: { metadata },
        success_url: request.successUrl,
        cancel_url: request.cancelUrl,
        expires_at: Math.floor(Date.now() / 1000) + CHECKOUT_WINDOW_SECONDS,
      },
      { idempotencyKey: `activation:${request.paymentId}` },
    );
    if (!session.url) {
      throw new Error("Stripe did not return a checkout link");
    }
    return { providerReference: session.id, redirectUrl: session.url };
  }

  async refund(request: RefundRequest): Promise<string> {
    const refund = await this.client.refunds.create({ payment_intent: request.paymentId, amount: request.amountMinor }, { idempotencyKey: request.idempotencyKey });
    return refund.id;
  }

  parseWebhook(rawBody: Buffer, headers: Record<string, string | string[] | undefined>): ParsedEvent {
    const signature = headers["stripe-signature"];
    let event: Stripe.Event;
    try {
      event = this.client.webhooks.constructEvent(rawBody, typeof signature === "string" ? signature : "", this.webhookSecret, TOLERANCE_SECONDS);
    } catch {
      throw new WebhookSignatureError();
    }
    return { ...this.normalise(event), type: event.type, payload: event };
  }

  private normalise(event: Stripe.Event): PaymentEvent {
    switch (event.type) {
      case "checkout.session.completed":
      case "checkout.session.async_payment_succeeded":
        return this.sessionPaid(event.id, event.data.object);
      case "checkout.session.expired":
      case "checkout.session.async_payment_failed":
        if (event.data.object.metadata?.purpose === ORDER_PURPOSE) {
          return {
            kind: "ORDER_CLOSED",
            orderKind: orderKindOf(event.data.object.metadata),
            eventId: event.id,
            orderId: event.data.object.metadata.orderId ?? "",
            providerReference: event.data.object.id,
            outcome: event.type === "checkout.session.expired" ? "EXPIRED" : "FAILED",
          };
        }
        return {
          kind: "TOP_UP_CLOSED",
          eventId: event.id,
          topUpId: event.data.object.metadata?.topUpId ?? "",
          providerReference: event.data.object.id,
          outcome: event.type === "checkout.session.expired" ? "EXPIRED" : "FAILED",
        };
      case "charge.refunded":
        return {
          kind: "PAYMENT_REFUNDED",
          eventId: event.id,
          paymentId: idOf(event.data.object.payment_intent),
          refundedTotalMinor: event.data.object.amount_refunded,
          currency: event.data.object.currency.toUpperCase(),
        };
      case "charge.dispute.created":
      case "charge.dispute.closed":
        return {
          kind: "PAYMENT_DISPUTED",
          eventId: event.id,
          paymentId: idOf(event.data.object.payment_intent),
          amountMinor: event.data.object.amount,
          currency: event.data.object.currency.toUpperCase(),
          stage: event.type === "charge.dispute.created" ? "OPENED" : event.data.object.status === "lost" ? "LOST" : "WON",
        };
      default:
        return { kind: "IGNORED", eventId: event.id, type: event.type };
    }
  }

  private sessionPaid(eventId: string, session: Stripe.Checkout.Session): PaymentEvent {
    if (session.payment_status === "paid" && session.metadata?.purpose === ORDER_PURPOSE) {
      return {
        kind: "ORDER_PAID",
        orderKind: orderKindOf(session.metadata),
        eventId,
        orderId: session.metadata.orderId ?? "",
        providerReference: session.id,
        paymentId: idOf(session.payment_intent),
        amountMinor: session.amount_total ?? 0,
        currency: (session.currency ?? "").toUpperCase(),
      };
    }
    if (session.payment_status !== "paid" || session.metadata?.purpose !== "wallet.top_up") {
      return { kind: "IGNORED", eventId, type: "checkout.session.unpaid" };
    }
    return {
      kind: "TOP_UP_PAID",
      eventId,
      topUpId: session.metadata.topUpId ?? "",
      providerReference: session.id,
      paymentId: idOf(session.payment_intent),
      amountMinor: session.amount_total ?? 0,
      currency: (session.currency ?? "").toUpperCase(),
    };
  }
}

function idOf(value: string | { id: string } | null | undefined): string {
  return typeof value === "string" ? value : (value?.id ?? "");
}
