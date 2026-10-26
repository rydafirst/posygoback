import { createHash, timingSafeEqual } from "node:crypto";

import { Injectable, Logger } from "@nestjs/common";

import { Errors } from "../../../common/http/app-exception";
import { isUniqueViolation, lockRow, PrismaService } from "../../../database/prisma.service";
import type { Order } from "../../../generated/prisma/client";
import { PartnerEarningsService } from "../../partners/ledger/partner-earnings.service";
import { AuditService } from "../../../infrastructure/audit/audit.service";
import { type CarrierTrackingEvent, canMoveOrder, type PublicTrackingView, publicTrackingStatus, statusForTracking } from "../../../shared";
import { WalletAlertsService } from "../../finance/wallets/wallet-alerts.service";
import { CarrierAccountsService } from "../carriers/carrier-accounts.service";
import { type CarrierAdapter, CarrierError } from "../carriers/carrier.port";
import { OrderEmails } from "../order-emails";
import { OrderTimelineService } from "./order-timeline.service";
import { StockAllocationService } from "./stock-allocation.service";

const SHIPPED_STATUSES = new Set(["IN_TRANSIT", "DELIVERED", "RETURNED", "EXCEPTION"]);

function sameSecret(given: string, expected: string): boolean {
  const left = createHash("sha256").update(given).digest();
  const right = createHash("sha256").update(expected).digest();
  return timingSafeEqual(left, right);
}

@Injectable()
export class OrderTrackingService {
  private readonly logger = new Logger(OrderTrackingService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly carriers: CarrierAccountsService,
    private readonly allocation: StockAllocationService,
    private readonly timeline: OrderTimelineService,
    private readonly alerts: WalletAlertsService,
    private readonly earnings: PartnerEarningsService,
    private readonly audit: AuditService,
  ) {}

  async webhook(accountKey: string, token: string, rawBody: Buffer | undefined, body: unknown): Promise<string> {
    const resolved = this.carriers.find(accountKey);
    if (!resolved || resolved.account.provider !== "SHIPPO" || !sameSecret(token, resolved.account.webhookToken)) {
      throw Errors.notFound();
    }
    const target = resolved.adapter.trackingTarget(body);
    if (!target) {
      return "ignored";
    }
    const eventKey = createHash("sha256")
      .update(rawBody ?? JSON.stringify(body))
      .digest("hex");
    if (await this.prisma.carrierWebhookEvent.findUnique({ where: { provider_accountKey_eventKey: { provider: "SHIPPO", accountKey, eventKey } } })) {
      return "duplicate";
    }
    const order = await this.prisma.order.findFirst({ where: { originCountryCode: accountKey, trackingNumber: target.trackingNumber, carrierCode: target.carrier.toLowerCase() } });
    const outcome = order ? await this.apply(order.id, await this.fetchEvents(resolved.adapter, order.carrierCode!, order.trackingNumber!)) : "no matching order";
    await this.prisma.carrierWebhookEvent.create({ data: { provider: "SHIPPO", accountKey, eventKey, outcome } }).catch((error: unknown) => {
      if (!isUniqueViolation(error)) {
        throw error;
      }
    });
    return outcome;
  }

  private async fetchEvents(adapter: CarrierAdapter, carrierCode: string, trackingNumber: string): Promise<CarrierTrackingEvent[]> {
    try {
      return (await adapter.track(carrierCode, trackingNumber)).events;
    } catch (error) {
      if (error instanceof CarrierError) {
        throw Errors.carrierFailed("Tracking couldn't be fetched from the carrier. Send the update again later.");
      }
      throw error;
    }
  }

  async simulate(orderId: string, event: CarrierTrackingEvent): Promise<string> {
    const order = await this.prisma.order.findUniqueOrThrow({ where: { id: orderId } });
    const resolved = this.carriers.find(order.originCountryCode);
    if (!resolved || resolved.adapter.provider !== "SANDBOX" || !order.trackingNumber) {
      throw Errors.notFound();
    }
    return this.apply(orderId, [event]);
  }

  async apply(orderId: string, events: CarrierTrackingEvent[]): Promise<string> {
    const ordered = [...events].sort((left, right) => left.occurredAt.localeCompare(right.occurredAt));
    const result = await this.prisma.$transaction(async (tx) => {
      await lockRow(tx, "orders", orderId);
      const order = await tx.order.findUniqueOrThrow({ where: { id: orderId } });
      const added = await this.timeline.addOnce(
        tx,
        orderId,
        ordered.map((event) => ({
          type: `carrier.${event.status.toLowerCase()}`,
          description: event.description,
          source: "CARRIER" as const,
          location: event.location,
          occurredAt: new Date(event.occurredAt),
          dedupeKey: `${event.status}:${event.occurredAt}`,
        })),
      );
      const latest = ordered.at(-1);
      const target = latest ? statusForTracking(latest.status) : null;
      if (!target || target === order.status || !canMoveOrder(order.status, target)) {
        return { order, moved: null, added };
      }
      if (SHIPPED_STATUSES.has(target)) {
        await this.allocation.ship(tx, order, null);
        await this.earnings.orderShipped(tx, order);
      }
      await tx.order.update({
        where: { id: orderId },
        data: { status: target, deliveredAt: target === "DELIVERED" ? new Date(latest!.occurredAt) : undefined, handedOffAt: order.handedOffAt ?? new Date(latest!.occurredAt) },
      });
      await this.audit.record(
        {
          actor: { userId: null, role: null },
          action: "order.tracking_moved",
          resourceType: "order",
          resourceId: orderId,
          vendorId: order.vendorId,
          before: { status: order.status },
          after: { status: target },
        },
        tx,
      );
      return { order, moved: target, added };
    });
    if (result.moved === "EXCEPTION") {
      await this.notifyProblem(result.order, ordered.at(-1)!.description);
    }
    return result.moved ? `moved to ${result.moved}` : `${result.added} new events`;
  }

  async publicView(trackingNumber: string): Promise<PublicTrackingView> {
    const order = await this.prisma.order.findFirst({
      where: { trackingNumber },
      include: { events: { where: { source: "CARRIER" }, orderBy: { occurredAt: "desc" }, take: 50 } },
      orderBy: { labelPurchasedAt: "desc" },
    });
    if (!order) {
      throw Errors.notFound();
    }
    return {
      reference: order.reference,
      status: publicTrackingStatus(order.status),
      carrier: order.carrier,
      trackingNumber: order.trackingNumber,
      trackingUrl: order.trackingUrl,
      destination: { city: order.recipientCity, countryCode: order.destinationCountryCode },
      events: order.events.map((event) => ({ description: event.description, occurredAt: event.occurredAt.toISOString(), location: event.location })),
    };
  }

  private async notifyProblem(order: Order, description: string): Promise<void> {
    await this.alerts.notifyOwner(order.vendorId, (to) => OrderEmails.problem(to, order.reference, description), "/orders").catch((error: unknown) => this.logger.error(String(error)));
  }
}
