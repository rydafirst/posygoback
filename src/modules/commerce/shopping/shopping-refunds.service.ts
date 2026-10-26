import { Injectable, Logger } from "@nestjs/common";

import { Errors } from "../../../common/http/app-exception";
import { lockRow, PrismaService } from "../../../database/prisma.service";
import type { Prisma, ShoppingRefund } from "../../../generated/prisma/client";
import { type AuditActor, AuditService, SYSTEM_ACTOR } from "../../../infrastructure/audit/audit.service";
import { PaymentAccountsService } from "../../finance/payments/payment-accounts.service";

const COUNTED = ["PENDING", "SUCCEEDED"];
const STALE_MS = 5 * 60 * 1000;

@Injectable()
export class ShoppingRefundsService {
  private readonly logger = new Logger(ShoppingRefundsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly payments: PaymentAccountsService,
    private readonly audit: AuditService,
  ) {}

  async reserve(tx: Prisma.TransactionClient, requestId: string, amountMinor: number, intentKey: string, reason: string): Promise<ShoppingRefund | null> {
    const request = await tx.shoppingRequest.findUniqueOrThrow({ where: { id: requestId }, include: { refunds: true } });
    if (!request.paymentId || !request.paidAt) {
      return null;
    }
    const existing = request.refunds.find((refund) => refund.intentKey === intentKey);
    if (existing && existing.status !== "FAILED") {
      return existing;
    }
    const others = request.refunds.filter((refund) => refund.intentKey !== intentKey && COUNTED.includes(refund.status));
    const committed = Math.max(
      Number(request.refundedMinor),
      others.reduce((total, refund) => total + Number(refund.amountMinor), 0),
    );
    const remaining = Number(request.totalMinor) - committed;
    if (existing) {
      if (Number(existing.amountMinor) > remaining) {
        throw Errors.invalidTransition("This refund is more than is left to give back. Check the payment provider before trying again.");
      }
      return tx.shoppingRefund.update({ where: { id: existing.id }, data: { status: "PENDING" } });
    }
    const amount = Math.min(amountMinor, remaining);
    return amount > 0 ? tx.shoppingRefund.create({ data: { requestId, intentKey, amountMinor: BigInt(amount), reason } }) : null;
  }

  async send(intentId: string, actor: AuditActor): Promise<number> {
    const intent = await this.prisma.shoppingRefund.findUniqueOrThrow({ where: { id: intentId }, include: { request: true } });
    if (intent.status === "SUCCEEDED") {
      return Number(intent.amountMinor);
    }
    const { processor } = this.payments.forCountry(intent.request.countryCode);
    let refundId: string;
    try {
      refundId = await processor.refund({ paymentId: intent.request.paymentId!, amountMinor: Number(intent.amountMinor), idempotencyKey: `shopping-refund:${intent.id}` });
    } catch {
      await this.prisma.shoppingRefund.updateMany({ where: { id: intent.id, status: "PENDING" }, data: { status: "FAILED" } });
      throw Errors.carrierFailed("The payment provider didn't accept the refund. It will be tried again shortly.");
    }
    await this.prisma.$transaction(async (tx) => {
      await lockRow(tx, "shoppingRequests", intent.requestId);
      await tx.shoppingRefund.update({ where: { id: intent.id }, data: { status: "SUCCEEDED", providerRefundId: refundId } });
      const settled = await tx.shoppingRefund.aggregate({ where: { requestId: intent.requestId, status: "SUCCEEDED" }, _sum: { amountMinor: true } });
      const current = await tx.shoppingRequest.findUniqueOrThrow({ where: { id: intent.requestId } });
      const total = Math.min(Math.max(Number(current.refundedMinor), Number(settled._sum.amountMinor ?? 0)), Number(current.totalMinor));
      await tx.shoppingRequest.update({ where: { id: intent.requestId }, data: { refundedMinor: BigInt(total) } });
      await this.audit.record(
        {
          actor,
          action: "shopping.refund_sent",
          resourceType: "shopping_request",
          resourceId: intent.requestId,
          countryCode: current.countryCode,
          after: { amountMinor: Number(intent.amountMinor), refundId, reason: intent.reason },
        },
        tx,
      );
    });
    return Number(intent.amountMinor);
  }

  async refund(requestId: string, amountMinor: number, intentKey: string, actor: AuditActor, reason: string): Promise<number> {
    const intent = await this.prisma.$transaction(async (tx) => {
      await lockRow(tx, "shoppingRequests", requestId);
      return this.reserve(tx, requestId, amountMinor, intentKey, reason);
    });
    return intent ? this.send(intent.id, actor) : 0;
  }

  async retry(requestId: string, actor: AuditActor): Promise<number> {
    const due = await this.prisma.shoppingRefund.findMany({ where: { requestId, status: { not: "SUCCEEDED" } } });
    for (const refund of due) {
      await this.refund(requestId, Number(refund.amountMinor), refund.intentKey, actor, refund.reason);
    }
    return due.length;
  }

  async retryStale(now = new Date()): Promise<number> {
    const due = await this.prisma.shoppingRefund.findMany({
      where: { OR: [{ status: "FAILED" }, { status: "PENDING", updatedAt: { lt: new Date(now.getTime() - STALE_MS) } }] },
      take: 50,
      orderBy: { updatedAt: "asc" },
    });
    let sent = 0;
    for (const refund of due) {
      try {
        await this.refund(refund.requestId, Number(refund.amountMinor), refund.intentKey, SYSTEM_ACTOR, refund.reason);
        sent += 1;
      } catch (error) {
        this.logger.warn(`Shopping refund ${refund.id} still failing: ${String(error)}`);
      }
    }
    return sent;
  }
}
