import { Inject, Injectable } from "@nestjs/common";

import { Errors } from "../../../common/http/app-exception";
import { lockRow, PrismaService } from "../../../database/prisma.service";
import type { Prisma, StorefrontRefund } from "../../../generated/prisma/client";
import { type AuditActor, AuditService } from "../../../infrastructure/audit/audit.service";
import { EMAIL_SENDER, type EmailSender } from "../../../infrastructure/email/email.port";
import { Money } from "../../../shared";
import { PaymentAccountsService } from "../../finance/payments/payment-accounts.service";
import { CommerceEmails } from "../commerce-emails";

export interface RefundResult {
  refundId: string;
  refundedMinor: number;
}

const COUNTED = ["PENDING", "SUCCEEDED"];

export function refundedTotal(current: bigint, refunds: Pick<StorefrontRefund, "status" | "amountMinor">[]): number {
  const settled = refunds.filter((refund) => refund.status === "SUCCEEDED").reduce((total, refund) => total + Number(refund.amountMinor), 0);
  return Math.max(Number(current), settled);
}

@Injectable()
export class StorefrontRefundsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly payments: PaymentAccountsService,
    @Inject(EMAIL_SENDER) private readonly email: EmailSender,
    private readonly audit: AuditService,
  ) {}

  async refund(orderId: string, amountMinor: number, intentKey: string, actor: AuditActor, reason: string): Promise<RefundResult> {
    const intent = await this.reserve(orderId, amountMinor, intentKey, reason);
    if (intent.status === "SUCCEEDED") {
      const order = await this.prisma.storefrontOrder.findUniqueOrThrow({ where: { id: orderId }, select: { refundedMinor: true } });
      return { refundId: intent.providerRefundId!, refundedMinor: Number(order.refundedMinor) };
    }
    const order = await this.prisma.storefrontOrder.findUniqueOrThrow({
      where: { id: orderId },
      include: { vendor: { select: { businessName: true, storefront: { select: { displayName: true } } } } },
    });
    const { processor } = this.payments.forCountry(order.countryCode);
    let refundId: string;
    try {
      refundId = await processor.refund({ paymentId: order.paymentId!, amountMinor: Number(intent.amountMinor), idempotencyKey: `storefront-refund:${intent.id}` });
    } catch {
      await this.prisma.storefrontRefund.updateMany({ where: { id: intent.id, status: "PENDING" }, data: { status: "FAILED" } });
      throw Errors.carrierFailed("The payment provider didn't accept the refund. Try again shortly.");
    }
    const refundedMinor = await this.prisma.$transaction((tx) => this.settle(tx, intent, refundId, actor));
    const store = order.vendor.storefront?.displayName ?? order.vendor.businessName;
    await this.email.send(CommerceEmails.orderRefunded(order.buyerEmail, store, order.reference, Money.of(Number(intent.amountMinor), order.currency).format("en-GB"))).catch(() => undefined);
    return { refundId, refundedMinor };
  }

  private reserve(orderId: string, amountMinor: number, intentKey: string, reason: string): Promise<StorefrontRefund> {
    return this.prisma.$transaction(async (tx) => {
      await lockRow(tx, "storefrontOrders", orderId);
      const order = await tx.storefrontOrder.findUniqueOrThrow({ where: { id: orderId }, include: { refunds: true } });
      if (!order.paymentId || !order.paidAt) {
        throw Errors.invalidTransition("This order hasn't been paid.");
      }
      const existing = order.refunds.find((refund) => refund.intentKey === intentKey);
      if (existing?.status === "SUCCEEDED" || existing?.status === "PENDING") {
        return existing;
      }
      const others = order.refunds.filter((refund) => refund.intentKey !== intentKey && COUNTED.includes(refund.status));
      const committed = Math.max(
        Number(order.refundedMinor),
        others.reduce((total, refund) => total + Number(refund.amountMinor), 0),
      );
      const amount = Math.min(amountMinor, Number(order.totalMinor) - committed);
      if (amount <= 0) {
        throw Errors.invalidTransition("This order has already been refunded in full.");
      }
      if (existing) {
        return tx.storefrontRefund.update({ where: { id: existing.id }, data: { status: "PENDING", amountMinor: BigInt(amount) } });
      }
      return tx.storefrontRefund.create({ data: { storefrontOrderId: orderId, intentKey, amountMinor: BigInt(amount), reason } });
    });
  }

  private async settle(tx: Prisma.TransactionClient, intent: StorefrontRefund, refundId: string, actor: AuditActor): Promise<number> {
    await lockRow(tx, "storefrontOrders", intent.storefrontOrderId);
    await tx.storefrontRefund.update({ where: { id: intent.id }, data: { status: "SUCCEEDED", providerRefundId: refundId } });
    const current = await tx.storefrontOrder.findUniqueOrThrow({ where: { id: intent.storefrontOrderId }, include: { refunds: true } });
    const total = Math.min(refundedTotal(current.refundedMinor, current.refunds), Number(current.totalMinor));
    const full = total >= Number(current.totalMinor);
    await tx.storefrontOrder.update({
      where: { id: current.id },
      data: {
        refundedMinor: BigInt(total),
        status: full ? "REFUNDED" : current.status,
        payoutStatus: full && ["HELD", "PENDING", "FAILED"].includes(current.payoutStatus) ? "CANCELLED" : current.payoutStatus,
      },
    });
    await this.audit.record(
      {
        actor,
        action: "storefront.refund_sent",
        resourceType: "storefront_order",
        resourceId: current.id,
        vendorId: current.vendorId,
        countryCode: current.countryCode,
        after: { amountMinor: Number(intent.amountMinor), refundId, reason: intent.reason },
      },
      tx,
    );
    return total;
  }
}
