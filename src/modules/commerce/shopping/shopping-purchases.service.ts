import { createHash } from "node:crypto";

import { Inject, Injectable, Logger } from "@nestjs/common";

import type { AuthPrincipal, RequestMeta } from "../../../common/auth/auth-principal";
import { Errors } from "../../../common/http/app-exception";
import { lockRow, PrismaService } from "../../../database/prisma.service";
import { type AuditActor, AuditService } from "../../../infrastructure/audit/audit.service";
import { EMAIL_SENDER, type EmailMessage, type EmailSender } from "../../../infrastructure/email/email.port";
import { Money, type ShoppingPurchaseInput, type ShoppingRequestView, type ShoppingStatus } from "../../../shared";
import { ShoppingEmails } from "./shopping-emails";
import { ShoppingQuotesService } from "./shopping-quotes.service";
import { ShoppingRefundsService } from "./shopping-refunds.service";

const BUYABLE: ShoppingStatus[] = ["PAID", "BUYING"];
const STAFF_CANCELLABLE: ShoppingStatus[] = ["REQUESTED", "QUOTED", "EXPIRED", "PAID", "BUYING"];

export function commissionShare(row: { commissionMinor: bigint; goodsMinor: bigint }, goodsMinor: number): number {
  return Number(row.goodsMinor) === 0 ? 0 : Math.round((Number(row.commissionMinor) * goodsMinor) / Number(row.goodsMinor));
}

export function actorOf(principal: AuthPrincipal): AuditActor {
  return { userId: principal.userId, role: principal.role };
}

@Injectable()
export class ShoppingPurchasesService {
  private readonly logger = new Logger(ShoppingPurchasesService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly quotes: ShoppingQuotesService,
    private readonly refunds: ShoppingRefundsService,
    private readonly audit: AuditService,
    @Inject(EMAIL_SENDER) private readonly email: EmailSender,
  ) {}

  async purchase(principal: AuthPrincipal, requestId: string, input: ShoppingPurchaseInput, meta: RequestMeta): Promise<ShoppingRequestView> {
    const row = await this.quotes.scoped(principal, requestId);
    const outcome = await this.prisma.$transaction(async (tx) => {
      await lockRow(tx, "shoppingRequests", row.id);
      const current = await tx.shoppingRequest.findUniqueOrThrow({ where: { id: row.id }, include: { lines: true } });
      const open = new Map(current.lines.filter((line) => line.status === "QUOTED").map((line) => [line.id, line]));
      if (!BUYABLE.includes(current.status) || open.size === 0) {
        throw Errors.invalidTransition("There's nothing left to buy on this request.");
      }
      if (current.disputeOpen) {
        throw Errors.invalidTransition("The buyer has disputed this payment with their card provider. Wait until it's settled.");
      }
      if (input.lines.some((line) => !open.has(line.lineId))) {
        throw Errors.validation({ lines: ["Only items still waiting to be bought can be updated"] });
      }
      for (const entry of input.lines) {
        await tx.shoppingLine.update({ where: { id: entry.lineId }, data: entry.bought ? { status: "BOUGHT", retailerOrderRef: entry.retailerOrderRef ?? null } : { status: "OUT_OF_STOCK" } });
      }
      const missing = input.lines.filter((entry) => !entry.bought);
      const missingMinor = missing.reduce((total, entry) => total + Number(open.get(entry.lineId)!.unitPriceMinor) * open.get(entry.lineId)!.quantity, 0);
      const stillOpen = open.size - input.lines.length;
      const allGone = stillOpen === 0 && missing.length === input.lines.length && !current.lines.some((line) => line.status === "BOUGHT");
      await tx.shoppingRequest.update({ where: { id: row.id }, data: allGone ? { status: "CANCELLED", cancelReason: "None of the items could be bought." } : { status: "BUYING" } });
      await this.audit.record(
        {
          actor: actorOf(principal),
          action: "shopping.purchased",
          resourceType: "shopping_request",
          resourceId: row.id,
          countryCode: row.countryCode,
          after: { bought: input.lines.length - missing.length, missing: missing.length },
          meta,
        },
        tx,
      );
      if (allGone) {
        return { allGone, intent: await this.refunds.reserve(tx, row.id, Number(current.totalMinor), `shopping-cancel:${row.id}`, "None of the items could be bought") };
      }
      if (missingMinor === 0) {
        return { allGone, intent: null };
      }
      const key = createHash("sha256")
        .update(
          missing
            .map((entry) => entry.lineId)
            .sort()
            .join(","),
        )
        .digest("hex")
        .slice(0, 40);
      return { allGone, intent: await this.refunds.reserve(tx, row.id, missingMinor + commissionShare(current, missingMinor), `shopping-oos:${key}`, "Items out of stock") };
    });
    if (outcome.allGone) {
      await this.sendThenTell(outcome.intent?.id ?? null, actorOf(principal), (amount) =>
        ShoppingEmails.cancelled(row.buyerEmail, row.reference, "None of the items could be bought, so we've cancelled your request.", amount),
      );
    } else if (outcome.intent) {
      await this.sendThenTell(outcome.intent.id, actorOf(principal), (amount) => (amount ? ShoppingEmails.partlyRefunded(row.buyerEmail, row.reference, amount) : null));
    }
    return this.quotes.detail(principal, row.id);
  }

  async cancel(principal: AuthPrincipal, requestId: string, reason: string, meta: RequestMeta): Promise<ShoppingRequestView> {
    const row = await this.quotes.scoped(principal, requestId);
    const intent = await this.prisma.$transaction(async (tx) => {
      await lockRow(tx, "shoppingRequests", row.id);
      const cancelled = await tx.shoppingRequest.updateMany({ where: { id: row.id, status: { in: STAFF_CANCELLABLE } }, data: { status: "CANCELLED", cancelReason: reason } });
      if (cancelled.count === 0) {
        throw Errors.invalidTransition("Items have already arrived, so this request can't be cancelled.");
      }
      await this.audit.record(
        { actor: actorOf(principal), action: "shopping.cancelled", resourceType: "shopping_request", resourceId: row.id, countryCode: row.countryCode, after: { reason }, meta },
        tx,
      );
      const current = await tx.shoppingRequest.findUniqueOrThrow({ where: { id: row.id } });
      return this.refunds.reserve(tx, row.id, Number(current.totalMinor), `shopping-cancel:${row.id}`, reason);
    });
    await this.sendThenTell(intent?.id ?? null, actorOf(principal), (amount) => ShoppingEmails.cancelled(row.buyerEmail, row.reference, reason, amount));
    return this.quotes.detail(principal, row.id);
  }

  async retryRefund(principal: AuthPrincipal, requestId: string): Promise<ShoppingRequestView> {
    const row = await this.quotes.scoped(principal, requestId);
    if ((await this.refunds.retry(row.id, actorOf(principal))) === 0) {
      throw Errors.invalidTransition("There's no refund waiting to be sent.");
    }
    return this.quotes.detail(principal, row.id);
  }

  async sendThenTell(intentId: string | null, actor: AuditActor, message: (refunded: string | null) => EmailMessage | null): Promise<void> {
    let refunded: string | null = null;
    if (intentId) {
      try {
        const intent = await this.prisma.shoppingRefund.findUniqueOrThrow({ where: { id: intentId }, include: { request: { select: { currency: true } } } });
        refunded = Money.of(await this.refunds.send(intentId, actor), intent.request.currency).format("en-GB");
      } catch (error) {
        this.logger.warn(`Shopping refund ${intentId} will be retried: ${String(error)}`);
      }
    }
    const email = message(refunded);
    if (email) {
      await this.email.send(email).catch(() => undefined);
    }
  }
}
