import { Injectable } from "@nestjs/common";

import { Prisma } from "../../../generated/prisma/client";
import { type PostingResult, WalletLedgerService } from "../../finance/wallets/wallet-ledger.service";

export interface ChargeableOrder {
  id: string;
  reference: string;
  vendorId: string;
  currency: string;
}

const ORDER_REFERENCE = (orderId: string) => ({ type: "order", id: orderId });

@Injectable()
export class OrderChargesService {
  constructor(private readonly ledger: WalletLedgerService) {}

  async chargeFulfilment(tx: Prisma.TransactionClient, order: ChargeableOrder, feeMinor: number, actorId: string | null): Promise<PostingResult | null> {
    if (feeMinor <= 0) {
      return null;
    }
    return this.ledger.post(tx, await this.walletId(tx, order), {
      type: "FULFILMENT",
      amountMinor: feeMinor,
      description: `Fulfilment for order ${order.reference}`,
      idempotencyKey: `fulfilment:${order.id}`,
      reference: ORDER_REFERENCE(order.id),
      actorId,
    });
  }

  async chargeShipping(tx: Prisma.TransactionClient, order: ChargeableOrder, quoteId: string, chargeMinor: number, actorId: string | null): Promise<PostingResult> {
    return this.ledger.post(tx, await this.walletId(tx, order), {
      type: "SHIPPING",
      amountMinor: chargeMinor,
      description: `Shipping for order ${order.reference}`,
      idempotencyKey: `shipping:${order.id}:${quoteId}`,
      reference: ORDER_REFERENCE(order.id),
      actorId,
    });
  }

  async refundShipping(tx: Prisma.TransactionClient, order: ChargeableOrder, quoteId: string, chargeMinor: number): Promise<PostingResult> {
    const posting = await this.ledger.post(tx, await this.walletId(tx, order), {
      type: "REVERSAL",
      amountMinor: chargeMinor,
      description: `Shipping returned for order ${order.reference}: the label couldn't be bought`,
      idempotencyKey: `shipping-refund:${order.id}:${quoteId}`,
      reference: ORDER_REFERENCE(order.id),
    });
    await tx.order.update({ where: { id: order.id }, data: { refundedMinor: { increment: chargeMinor } } });
    return posting;
  }

  async refundEverything(tx: Prisma.TransactionClient, order: ChargeableOrder, actorId: string | null): Promise<number> {
    const [{ net }] = await tx.$queryRaw<[{ net: bigint | null }]>`
      SELECT sum(amount_minor)::bigint AS net FROM ledger_entries WHERE reference_type = 'order' AND reference_id = ${order.id}`;
    const owed = net === null ? 0 : -Number(net);
    if (owed <= 0) {
      return 0;
    }
    await this.ledger.post(tx, await this.walletId(tx, order), {
      type: "REVERSAL",
      amountMinor: owed,
      description: `Refund for cancelled order ${order.reference}`,
      idempotencyKey: `order-cancel:${order.id}`,
      reference: ORDER_REFERENCE(order.id),
      actorId,
    });
    await tx.order.update({ where: { id: order.id }, data: { refundedMinor: { increment: owed } } });
    return owed;
  }

  private async walletId(tx: Prisma.TransactionClient, order: ChargeableOrder): Promise<string> {
    return (await this.ledger.walletFor(tx, order.vendorId, order.currency)).id;
  }
}
