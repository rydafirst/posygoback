import { Injectable } from "@nestjs/common";

import type { AuthPrincipal, RequestMeta } from "../../../common/auth/auth-principal";
import { PrismaService } from "../../../database/prisma.service";
import type { Prisma } from "../../../generated/prisma/client";
import {
  type CreateOrdersInput,
  fulfilmentFee,
  type OrderDetailView,
  type OrderEstimateView,
  type OrderStatus,
  type OrderSummaryView,
  type VendorOrderActionInput,
  vendorOrderActions,
} from "../../../shared";
import { FeeSchedulesService } from "../../finance/fees/fee-schedules.service";
import { WalletLedgerService } from "../../finance/wallets/wallet-ledger.service";
import { vendorIdOf } from "../../onboarding/scope";
import { VendorStandingService } from "../../onboarding/vendor-standing.service";
import { OrderCancellationService } from "../core/order-cancellation.service";
import { type OrderActor, OrderCreationService } from "../core/order-creation.service";
import { OrderShippingService } from "../core/order-shipping.service";
import { OrdersRepository } from "../core/orders.repository";

export interface VendorOrderFilters {
  status?: OrderStatus;
  q?: string;
}

function actorOf(principal: AuthPrincipal): OrderActor {
  return { userId: principal.userId, role: principal.role, apiKeyId: null };
}

@Injectable()
export class VendorOrdersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly orders: OrdersRepository,
    private readonly creation: OrderCreationService,
    private readonly shipping: OrderShippingService,
    private readonly cancellation: OrderCancellationService,
    private readonly standing: VendorStandingService,
    private readonly fees: FeeSchedulesService,
    private readonly ledger: WalletLedgerService,
  ) {}

  list(principal: AuthPrincipal, filters: VendorOrderFilters): Promise<OrderSummaryView[]> {
    const search = filters.q?.trim();
    return this.orders.list({
      vendorId: vendorIdOf(principal),
      ...(filters.status ? { status: filters.status } : {}),
      ...(search
        ? {
            OR: [
              { reference: { contains: search, mode: "insensitive" } },
              { externalReference: { contains: search, mode: "insensitive" } },
              { trackingNumber: { contains: search, mode: "insensitive" } },
              { recipientName: { contains: search, mode: "insensitive" } },
            ],
          }
        : {}),
    });
  }

  async detail(principal: AuthPrincipal, orderId: string): Promise<OrderDetailView> {
    const row = await this.orders.detailRow({ id: orderId, vendorId: vendorIdOf(principal) });
    const pending = row.cancellations[0]?.status === "PENDING";
    return this.orders.detail(row, "VENDOR", vendorOrderActions(row.status, pending), row.source !== "STOREFRONT");
  }

  async create(principal: AuthPrincipal, input: CreateOrdersInput): Promise<OrderSummaryView[]> {
    const vendor = await this.standing.assertCanTrade(principal);
    const ids = await this.creation.create(vendor, actorOf(principal), "PORTAL", input.deliveries, input.warehouseId);
    return this.orders.list({ id: { in: ids } });
  }

  async estimate(principal: AuthPrincipal, units: number): Promise<OrderEstimateView> {
    const vendorId = vendorIdOf(principal);
    const country = principal.countryCode ?? "";
    const active = await this.fees.active(country);
    const wallet = await this.ledger.walletFor(this.prisma, vendorId, active.currency);
    return { currency: active.currency, fulfilmentFeeMinor: fulfilmentFee(active.schedule, units), balanceMinor: Number(wallet.balanceMinor) };
  }

  async act(principal: AuthPrincipal, orderId: string, input: VendorOrderActionInput, meta: RequestMeta): Promise<OrderDetailView> {
    const scope: Prisma.OrderWhereInput = { vendorId: vendorIdOf(principal) };
    const actor = actorOf(principal);
    switch (input.action) {
      case "CANCEL":
        await this.cancellation.vendorCancel(actor, orderId, scope, input.reason, input.note, meta);
        break;
      case "REQUEST_CANCELLATION":
        await this.cancellation.request(actor, orderId, scope, input.reason, input.note, meta);
        break;
      case "PAY_SHIPPING":
        await this.standing.assertCanTrade(principal);
        await this.shipping.payShipping(actor, orderId, scope);
        break;
    }
    return this.detail(principal, orderId);
  }
}
