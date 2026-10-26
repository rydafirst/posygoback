import { Injectable } from "@nestjs/common";

import type { Prisma } from "../../../generated/prisma/client";
import type { OrderKind, PaymentEvent } from "./payment-processor.port";

export interface PaymentOutcome {
  outcome: string;
  followUps: Array<() => Promise<void>>;
}

export type OrderPaymentEvent = Extract<PaymentEvent, { kind: "ORDER_PAID" | "ORDER_CLOSED" }>;
export type PaymentReversalEvent = Extract<PaymentEvent, { kind: "PAYMENT_REFUNDED" | "PAYMENT_DISPUTED" }>;

export interface OrderPaymentHandler {
  orderEvent(tx: Prisma.TransactionClient, provider: string, accountKey: string, event: OrderPaymentEvent): Promise<PaymentOutcome>;
  paymentReversal(tx: Prisma.TransactionClient, provider: string, accountKey: string, event: PaymentReversalEvent): Promise<PaymentOutcome | null>;
}

@Injectable()
export class OrderPaymentRouter {
  private readonly handlers = new Map<OrderKind, OrderPaymentHandler>();

  use(kind: OrderKind, handler: OrderPaymentHandler): void {
    this.handlers.set(kind, handler);
  }

  for(kind: OrderKind): OrderPaymentHandler | null {
    return this.handlers.get(kind) ?? null;
  }

  all(): OrderPaymentHandler[] {
    return [...this.handlers.values()];
  }
}
