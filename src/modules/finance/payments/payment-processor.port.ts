export interface CheckoutRequest {
  topUpId: string;
  currency: string;
  grossMinor: number;
  description: string;
  customerEmail: string;
  successUrl: string;
  cancelUrl: string;
}

export type OrderKind = "STORE" | "SHOPPING" | "ACTIVATION";

export interface OrderCheckoutRequest {
  kind: OrderKind;
  orderId: string;
  reference: string;
  storeName: string;
  currency: string;
  totalMinor: number;
  itemCount: number;
  customerEmail: string;
  successUrl: string;
  cancelUrl: string;
  expiresAt: Date;
}

export interface ActivationCheckoutRequest {
  paymentId: string;
  currency: string;
  amountMinor: number;
  description: string;
  customerEmail: string;
  successUrl: string;
  cancelUrl: string;
}

export interface RefundRequest {
  paymentId: string;
  amountMinor: number;
  idempotencyKey: string;
}

export interface CheckoutSession {
  providerReference: string;
  redirectUrl: string;
}

export type DisputeStage = "OPENED" | "WON" | "LOST";

export type PaymentEvent =
  | { kind: "TOP_UP_PAID"; eventId: string; topUpId: string; providerReference: string; paymentId: string; amountMinor: number; currency: string }
  | { kind: "TOP_UP_CLOSED"; eventId: string; topUpId: string; providerReference: string; outcome: "FAILED" | "EXPIRED" }
  | { kind: "PAYMENT_REFUNDED"; eventId: string; paymentId: string; refundedTotalMinor: number; currency: string }
  | { kind: "PAYMENT_DISPUTED"; eventId: string; paymentId: string; amountMinor: number; currency: string; stage: DisputeStage }
  | { kind: "ORDER_PAID"; orderKind: OrderKind; eventId: string; orderId: string; providerReference: string; paymentId: string; amountMinor: number; currency: string }
  | { kind: "ORDER_CLOSED"; orderKind: OrderKind; eventId: string; orderId: string; providerReference: string; outcome: "FAILED" | "EXPIRED" }
  | { kind: "IGNORED"; eventId: string; type: string };

export interface PaymentProcessor {
  readonly name: string;
  createCheckout(request: CheckoutRequest): Promise<CheckoutSession>;
  createOrderCheckout(request: OrderCheckoutRequest): Promise<CheckoutSession>;
  createActivationCheckout(request: ActivationCheckoutRequest): Promise<CheckoutSession>;
  refund(request: RefundRequest): Promise<string>;
  parseWebhook(rawBody: Buffer, headers: Record<string, string | string[] | undefined>): PaymentEvent & { type: string; payload: unknown };
}

export class PaymentEventNotReady extends Error {
  constructor(readonly reason: string) {
    super(reason);
    this.name = "PaymentEventNotReady";
  }
}

export class WebhookSignatureError extends Error {
  constructor() {
    super("Webhook signature could not be verified");
    this.name = "WebhookSignatureError";
  }
}
