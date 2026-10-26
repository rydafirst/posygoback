import { Inject, Injectable, Logger } from "@nestjs/common";

import type { AuthPrincipal, RequestMeta } from "../../../common/auth/auth-principal";
import { Errors } from "../../../common/http/app-exception";
import { PrismaService } from "../../../database/prisma.service";
import { AuditService, SYSTEM_ACTOR } from "../../../infrastructure/audit/audit.service";
import { Money } from "../../../shared";
import { WalletAlertsService } from "../../finance/wallets/wallet-alerts.service";
import { PAYOUT_GATEWAY, type PayoutGateway, TransferError } from "../../partners/providers/partner-services.port";
import { CommerceEmails } from "../commerce-emails";

const NEW_BANK_WAIT_MS = 72 * 60 * 60 * 1000;
const BATCH = 100;
const RELEASABLE = ["SHIPPED", "DELIVERED"] as const;

const NO_OPEN_RETURN = { none: { status: { in: ["REQUESTED" as const, "APPROVED" as const] } } };

@Injectable()
export class StorefrontPayoutsService {
  private readonly logger = new Logger(StorefrontPayoutsService.name);

  constructor(
    @Inject(PAYOUT_GATEWAY) private readonly gateway: PayoutGateway,
    private readonly prisma: PrismaService,
    private readonly owners: WalletAlertsService,
    private readonly audit: AuditService,
  ) {}

  async releaseDue(now: Date = new Date()): Promise<number> {
    const due = await this.prisma.storefrontOrder.findMany({
      where: {
        payoutStatus: { in: ["HELD", "FAILED"] },
        payoutReleaseAt: { lte: now },
        status: { in: [...RELEASABLE] },
        returns: NO_OPEN_RETURN,
        disputeOpen: false,
        vendor: { payoutAccount: { status: "ACTIVE", OR: [{ detailsChangedAt: null }, { detailsChangedAt: { lt: new Date(now.getTime() - NEW_BANK_WAIT_MS) } }] } },
      },
      select: { id: true },
      orderBy: { payoutReleaseAt: "asc" },
      take: BATCH,
    });
    let paid = 0;
    for (const order of due) {
      paid += (await this.pay(order.id)) ? 1 : 0;
    }
    return paid;
  }

  async retry(principal: AuthPrincipal, orderId: string, meta: RequestMeta): Promise<void> {
    const order = await this.prisma.storefrontOrder.findUnique({ where: { id: orderId } });
    if (!order) {
      throw Errors.notFound();
    }
    if (order.payoutStatus !== "FAILED") {
      throw Errors.invalidTransition("Only failed payouts can be retried.");
    }
    if (await this.prisma.storefrontReturn.count({ where: { storefrontOrderId: orderId, status: { in: ["REQUESTED", "APPROVED"] } } })) {
      throw Errors.invalidTransition("Settle the open return before paying the vendor.");
    }
    await this.audit.record({
      actor: { userId: principal.userId, role: principal.role },
      action: "storefront.payout_retried",
      resourceType: "storefront_order",
      resourceId: orderId,
      vendorId: order.vendorId,
      meta,
    });
    await this.pay(orderId);
  }

  private async pay(orderId: string): Promise<boolean> {
    const claimed = await this.prisma.storefrontOrder.updateMany({
      where: { id: orderId, payoutStatus: { in: ["HELD", "FAILED"] }, status: { in: [...RELEASABLE] }, disputeOpen: false, returns: NO_OPEN_RETURN },
      data: { payoutStatus: "PENDING" },
    });
    if (claimed.count === 0) {
      return false;
    }
    const order = await this.prisma.storefrontOrder.findUniqueOrThrow({ where: { id: orderId }, include: { vendor: { include: { payoutAccount: true } } } });
    const amount = Math.max(0, Number(order.vendorShareMinor) - Number(order.refundedMinor));
    const account = order.vendor.payoutAccount;
    if (amount === 0 || !account) {
      await this.prisma.storefrontOrder.update({ where: { id: orderId }, data: { payoutStatus: amount === 0 ? "CANCELLED" : "FAILED" } });
      return false;
    }
    try {
      const transferId = await this.gateway.transfer({ accountId: account.providerAccountId, amountMinor: amount, currency: order.currency, idempotencyKey: `storefront-payout:${order.id}` });
      await this.prisma.storefrontOrder.update({ where: { id: orderId }, data: { payoutStatus: "PAID", payoutTransferId: transferId, payoutPaidAt: new Date() } });
      await this.audit.record({
        actor: SYSTEM_ACTOR,
        action: "storefront.payout_paid",
        resourceType: "storefront_order",
        resourceId: orderId,
        vendorId: order.vendorId,
        countryCode: order.countryCode,
        after: { amountMinor: amount, transferId },
      });
      await this.owners.notifyOwner(order.vendorId, (to) => CommerceEmails.payoutSent(to, order.reference, Money.of(amount, order.currency).format("en-GB")), "/storefront").catch(() => undefined);
      return true;
    } catch (error) {
      const definite = error instanceof TransferError && error.definite;
      await this.prisma.storefrontOrder.update({ where: { id: orderId }, data: { payoutStatus: definite ? "FAILED" : "HELD" } });
      this.logger.error(`Store payout for ${order.reference} failed: ${String(error)}`);
      return false;
    }
  }
}
