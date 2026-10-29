import { Injectable, Logger } from "@nestjs/common";

import { PrismaService } from "../../../database/prisma.service";
import type { OrderSource } from "../../../generated/prisma/client";
import { WalletAlertsService } from "../../finance/wallets/wallet-alerts.service";
import { PartnerNotifierService } from "../../partners/partner-notifier.service";
import { OrderEmails } from "../order-emails";

const SELLER_PLACED: ReadonlySet<OrderSource> = new Set(["PORTAL", "CSV"]);

@Injectable()
export class OrderPlacedNoticesService {
  private readonly logger = new Logger(OrderPlacedNoticesService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly vendors: WalletAlertsService,
    private readonly partners: PartnerNotifierService,
  ) {}

  async placed(orderIds: readonly string[], source: OrderSource): Promise<void> {
    try {
      const orders = await this.prisma.order.findMany({
        where: { id: { in: [...orderIds] } },
        select: { id: true, reference: true, vendorId: true, vendor: { select: { businessName: true } }, warehouse: { select: { name: true, partnerId: true } } },
        orderBy: { createdAt: "asc" },
      });
      const first = orders[0];
      if (!first) {
        return;
      }
      if (SELLER_PLACED.has(source)) {
        const hubs = new Set(orders.map((order) => order.warehouse.name));
        const hubName = hubs.size === 1 ? first.warehouse.name : "the hub";
        await this.vendors.notifyOwner(first.vendorId, (to, webUrl) => OrderEmails.placed(to, orders, hubName, webUrl), orders.length === 1 ? `/orders/${first.id}` : "/orders");
      }
      for (const [partnerId, hubOrders] of this.byPartner(orders)) {
        const hubName = hubOrders[0]!.warehouse.name;
        await this.partners.notify(partnerId, (to, webUrl) => OrderEmails.toPack(to, hubOrders, first.vendor.businessName, hubName, webUrl));
      }
    } catch (error) {
      this.logger.error(`Couldn't send order placed notices: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  private byPartner<Placed extends { warehouse: { partnerId: string | null } }>(orders: readonly Placed[]): Map<string, Placed[]> {
    const grouped = new Map<string, Placed[]>();
    for (const order of orders) {
      const { partnerId } = order.warehouse;
      if (partnerId) {
        grouped.set(partnerId, [...(grouped.get(partnerId) ?? []), order]);
      }
    }
    return grouped;
  }
}
