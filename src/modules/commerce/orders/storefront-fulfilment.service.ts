import { Inject, Injectable, Logger } from "@nestjs/common";

import { AppException } from "../../../common/http/app-exception";
import { APP_CONFIG } from "../../../config/config.module";
import type { AppConfig } from "../../../config/config.schema";
import { PrismaService } from "../../../database/prisma.service";
import { AuditService, SYSTEM_ACTOR } from "../../../infrastructure/audit/audit.service";
import { EMAIL_SENDER, type EmailSender } from "../../../infrastructure/email/email.port";
import { ERROR_CODES, Money } from "../../../shared";
import { WalletAlertsService } from "../../finance/wallets/wallet-alerts.service";
import { VendorStandingService } from "../../onboarding/vendor-standing.service";
import { OrderCreationService } from "../../orders/core/order-creation.service";
import { CommerceEmails } from "../commerce-emails";
import { StorefrontRepository } from "../storefront.repository";
import { HoldWindowService } from "./hold-window.service";
import { StorefrontRefundsService } from "./storefront-refunds.service";

const STUCK_MS = 15 * 60 * 1000;
const SHIPPED = ["HANDED_OFF", "IN_TRANSIT", "EXCEPTION"] as const;
const STORE_NAME = { select: { businessName: true, storefront: { select: { displayName: true } } } } as const;

function storeName(vendor: { businessName: string; storefront: { displayName: string } | null }): string {
  return vendor.storefront?.displayName ?? vendor.businessName;
}

@Injectable()
export class StorefrontFulfilmentService {
  private readonly logger = new Logger(StorefrontFulfilmentService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly standing: VendorStandingService,
    private readonly creation: OrderCreationService,
    private readonly repository: StorefrontRepository,
    private readonly refunds: StorefrontRefundsService,
    private readonly holds: HoldWindowService,
    private readonly owners: WalletAlertsService,
    @Inject(EMAIL_SENDER) private readonly email: EmailSender,
    private readonly audit: AuditService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  async afterPayment(orderId: string): Promise<void> {
    await this.sendReceipts(orderId);
    await this.bridge(orderId);
  }

  async bridge(orderId: string): Promise<void> {
    const claimed = await this.prisma.storefrontOrder.updateMany({
      where: { id: orderId, status: { in: ["PAID", "AWAITING_VENDOR_FUNDS"] }, fulfilmentOrderId: null },
      data: { status: "FULFILLING" },
    });
    if (claimed.count === 0) {
      return;
    }
    const order = await this.prisma.storefrontOrder.findUniqueOrThrow({ where: { id: orderId }, include: { lines: true } });
    try {
      const vendor = await this.standing.assertVendorCanTrade(order.vendorId);
      const [fulfilmentOrderId] = await this.creation.create(vendor, { userId: null, role: null, apiKeyId: null }, "STOREFRONT", [
        { externalReference: order.reference, recipient: this.repository.shipTo(order), lines: order.lines.map((line) => ({ productId: line.productId, quantity: line.quantity })) },
      ]);
      await this.prisma.storefrontOrder.update({ where: { id: orderId }, data: { fulfilmentOrderId } });
      await this.audit.record({
        actor: SYSTEM_ACTOR,
        action: "storefront.order_sent_to_warehouse",
        resourceType: "storefront_order",
        resourceId: orderId,
        vendorId: order.vendorId,
        after: { fulfilmentOrderId },
      });
    } catch (error) {
      await this.handleFailure(order, error);
    }
  }

  async retryWaiting(): Promise<number> {
    const stuck = new Date(Date.now() - STUCK_MS);
    await this.prisma.storefrontOrder.updateMany({ where: { status: "FULFILLING", fulfilmentOrderId: null, updatedAt: { lt: stuck } }, data: { status: "PAID" } });
    const waiting = await this.prisma.storefrontOrder.findMany({ where: { status: { in: ["PAID", "AWAITING_VENDOR_FUNDS"] }, fulfilmentOrderId: null }, select: { id: true }, take: 200 });
    for (const order of waiting) {
      await this.bridge(order.id);
    }
    return waiting.length;
  }

  async syncShipping(): Promise<number> {
    const leaving = await this.prisma.storefrontOrder.findMany({
      where: { status: "FULFILLING", fulfilmentOrder: { status: { in: [...SHIPPED, "DELIVERED"] } } },
      select: { id: true, vendorId: true, countryCode: true, reference: true, buyerEmail: true, fulfilmentOrder: { select: { trackingNumber: true } }, vendor: STORE_NAME },
      take: 500,
    });
    for (const order of leaving) {
      const shippedAt = new Date();
      const window = await this.holds.from(this.prisma, order, shippedAt);
      const shipped = await this.prisma.storefrontOrder.updateMany({ where: { id: order.id, status: "FULFILLING" }, data: { status: "SHIPPED", shippedAt, ...window } });
      if (shipped.count > 0) {
        const tracking = order.fulfilmentOrder?.trackingNumber ?? null;
        await this.email.send(CommerceEmails.orderShipped(order.buyerEmail, storeName(order.vendor), order.reference, tracking, this.config.WEB_PUBLIC_URL)).catch(() => undefined);
      }
    }
    const delivered = await this.prisma.storefrontOrder.updateMany({ where: { status: "SHIPPED", fulfilmentOrder: { status: "DELIVERED" } }, data: { status: "DELIVERED" } });
    const cancelled = await this.prisma.storefrontOrder.findMany({ where: { status: "FULFILLING", fulfilmentOrder: { status: "CANCELLED" } }, select: { id: true, totalMinor: true } });
    for (const order of cancelled) {
      await this.refunds
        .refund(order.id, Number(order.totalMinor), `cancelled:${order.id}`, SYSTEM_ACTOR, "The warehouse order was cancelled")
        .catch((error: unknown) => this.logger.error(`Refund after cancellation failed for ${order.id}: ${String(error)}`));
    }
    return leaving.length + delivered.count + cancelled.length;
  }

  private async handleFailure(order: { id: string; vendorId: string; reference: string; totalMinor: bigint; status: string }, error: unknown): Promise<void> {
    const code = error instanceof AppException ? error.code : null;
    if (code === ERROR_CODES.insufficientFunds || code === ERROR_CODES.walletUnavailable) {
      await this.prisma.storefrontOrder.update({ where: { id: order.id }, data: { status: "AWAITING_VENDOR_FUNDS" } });
      await this.owners.notifyOwner(order.vendorId, (to) => CommerceEmails.awaitingFunds(to, order.reference, this.config.WEB_PUBLIC_URL), "/storefront").catch(() => undefined);
      return;
    }
    if (code === ERROR_CODES.insufficientStock) {
      await this.prisma.storefrontOrder.update({ where: { id: order.id }, data: { status: "PAID" } });
      await this.refunds.refund(order.id, Number(order.totalMinor), `no-stock:${order.id}`, SYSTEM_ACTOR, "Out of stock after payment").catch((refundError: unknown) => {
        this.logger.error(`Refund for ${order.reference} failed: ${String(refundError)}`);
      });
      return;
    }
    await this.prisma.storefrontOrder.update({ where: { id: order.id }, data: { status: "PAID" } });
    this.logger.error(`Couldn't send ${order.reference} to the warehouse: ${String(error)}`);
  }

  private async sendReceipts(orderId: string): Promise<void> {
    const order = await this.prisma.storefrontOrder.findUniqueOrThrow({ where: { id: orderId }, include: { lines: true, vendor: STORE_NAME } });
    const total = Money.of(Number(order.totalMinor), order.currency).format("en-GB");
    const items = order.lines.map((line) => `${line.quantity} × ${line.productName}`).join("\n");
    const webUrl = this.config.WEB_PUBLIC_URL;
    await this.email.send(CommerceEmails.orderConfirmed(order.buyerEmail, storeName(order.vendor), order.reference, total, items, webUrl)).catch(() => undefined);
    await this.owners.notifyOwner(order.vendorId, (to) => CommerceEmails.vendorNewOrder(to, order.reference, total, webUrl), "/storefront").catch(() => undefined);
  }
}
