import { Injectable, Logger } from "@nestjs/common";

import { AppException } from "../../common/http/app-exception";
import { PrismaService } from "../../database/prisma.service";
import type { ShopifyRequestOutcome } from "../../generated/prisma/client";
import type { OrderStatus } from "../../shared";
import { OrderCancellationService } from "../orders/core/order-cancellation.service";
import { IntegrationCatalogService } from "../orders/integration/integration-catalog.service";
import { IntegrationOrdersService } from "../orders/integration/integration-orders.service";
import { ShopifyAdminClient, ShopifyApiError, type ShopifyUserError, userErrorMessage } from "./shopify-admin.client";
import { type AssignedFulfilmentOrders, type FulfilmentOrderNode, mapFulfilmentOrder } from "./shopify-fulfilment-order";
import {
  ACCEPT_CANCELLATION,
  ACCEPT_FULFILMENT_REQUEST,
  ASSIGNED_FULFILMENT_ORDERS,
  CLOSE_FULFILMENT_ORDER,
  CREATE_FULFILMENT,
  REJECT_CANCELLATION,
  REJECT_FULFILMENT_REQUEST,
} from "./shopify-queries";
import { type LinkedShop, ShopifyShopsService } from "./shopify-shops.service";

export type ShopifyNotificationKind = "FULFILLMENT_REQUEST" | "CANCELLATION_REQUEST";

const MESSAGE_LIMIT = 300;
const SHIPMENT_BATCH = 50;
const SHIPPED: OrderStatus[] = ["HANDED_OFF", "IN_TRANSIT", "DELIVERED"];
const STOPPED: OrderStatus[] = ["CANCELLED", "RETURNED"];
const SYSTEM_META = { ip: "shopify", userAgent: "Shopify fulfilment service", correlationId: "shopify-cancellation" };

type MutationResult = Record<string, { userErrors: ShopifyUserError[] }>;

@Injectable()
export class ShopifyFulfilmentService {
  private readonly logger = new Logger(ShopifyFulfilmentService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly shopify: ShopifyAdminClient,
    private readonly shops: ShopifyShopsService,
    private readonly orders: IntegrationOrdersService,
    private readonly catalog: IntegrationCatalogService,
    private readonly cancellation: OrderCancellationService,
  ) {}

  async notify(shopDomain: string, kind: ShopifyNotificationKind): Promise<void> {
    const linked = await this.shops.linked(shopDomain);
    if (!linked) {
      return;
    }
    if (kind === "FULFILLMENT_REQUEST") {
      for (const node of await this.assigned(linked, "FULFILLMENT_REQUESTED")) {
        await this.handleRequest(linked, node);
      }
      return;
    }
    for (const node of await this.assigned(linked, "CANCELLATION_REQUESTED")) {
      await this.handleCancellation(linked, node);
    }
  }

  async stock(shopDomain: string, sku: string | undefined): Promise<Record<string, number>> {
    const linked = await this.shops.linked(shopDomain);
    if (!linked) {
      return {};
    }
    const stock = await this.catalog.stock(linked.client, linked.shop.country!);
    const levels = Object.fromEntries(stock.items.map((item) => [item.productCode, item.available]));
    if (!sku) {
      return levels;
    }
    const code = sku.trim().toUpperCase();
    return { [sku]: levels[code] ?? 0 };
  }

  async syncShipments(): Promise<void> {
    const pending = await this.prisma.shopifyFulfilmentRequest.findMany({
      where: { outcome: "ACCEPTED", order: { status: { in: [...SHIPPED, ...STOPPED] } } },
      include: { order: true, shop: true },
      orderBy: { updatedAt: "asc" },
      take: SHIPMENT_BATCH,
    });
    for (const request of pending) {
      const linked = await this.shops.linked(request.shop.shopDomain);
      if (!linked || !request.order) {
        continue;
      }
      try {
        if (STOPPED.includes(request.order.status)) {
          await this.mutate(linked, CLOSE_FULFILMENT_ORDER, { id: request.fulfillmentOrderId, message: `Posygo order ${request.order.reference} was cancelled.` });
          await this.update(request.id, "CLOSED", `Posygo order ${request.order.reference} was cancelled, so it went back to you in Shopify.`);
          continue;
        }
        await this.mutate(linked, CREATE_FULFILMENT, {
          fulfillment: {
            lineItemsByFulfillmentOrder: [{ fulfillmentOrderId: request.fulfillmentOrderId }],
            notifyCustomer: true,
            trackingInfo: request.order.trackingNumber ? { company: request.order.carrier, number: request.order.trackingNumber, url: request.order.trackingUrl } : undefined,
          },
        });
        await this.update(request.id, "FULFILLED", `Shipped${request.order.trackingNumber ? ` with tracking ${request.order.trackingNumber}` : ""}. Shopify has emailed your customer.`);
      } catch (error) {
        this.logger.warn(`Shopify shipment update for ${request.fulfillmentOrderId} failed: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
  }

  private async handleRequest(linked: LinkedShop, node: FulfilmentOrderNode): Promise<void> {
    const existing = await this.prisma.shopifyFulfilmentRequest.findUnique({ where: { fulfillmentOrderId: node.id }, include: { order: true } });
    if (existing?.order) {
      await this.mutate(linked, ACCEPT_FULFILMENT_REQUEST, { id: node.id, message: `Posygo order ${existing.order.reference}` });
      return;
    }
    const mapped = mapFulfilmentOrder(node);
    if (mapped.kind === "skip") {
      await this.reject(linked, node, mapped.reason);
      return;
    }
    try {
      const placed = await this.orders.placeFor(linked.client.vendorId, mapped.order, linked.client.apiKeyId, "SHOPIFY");
      const order = await this.prisma.order.findUniqueOrThrow({ where: { reference: placed.order.reference }, include: { shopifyRequest: { select: { id: true } } } });
      await this.mutate(linked, ACCEPT_FULFILMENT_REQUEST, { id: node.id, message: `Posygo order ${order.reference}` });
      const message = placed.created ? `Posygo order ${order.reference} created. The hub will pack it.` : `Already received as Posygo order ${order.reference}.`;
      await this.record(linked, node, "ACCEPTED", message, order.shopifyRequest ? null : order.id);
    } catch (error) {
      if (error instanceof ShopifyApiError) {
        throw error;
      }
      await this.reject(linked, node, this.reason(error));
    }
  }

  private async handleCancellation(linked: LinkedShop, node: FulfilmentOrderNode): Promise<void> {
    const request = await this.prisma.shopifyFulfilmentRequest.findUnique({ where: { fulfillmentOrderId: node.id }, include: { order: true } });
    if (!request?.order || request.order.status === "CANCELLED") {
      await this.mutate(linked, ACCEPT_CANCELLATION, { id: node.id, message: "Cancelled at Posygo." });
      if (request) {
        await this.update(request.id, "CANCELLED", "Cancelled in Shopify before the hub packed it.");
      }
      return;
    }
    try {
      await this.cancellation.vendorCancel({ userId: null, role: null, apiKeyId: linked.client.apiKeyId }, request.order.id, { vendorId: linked.client.vendorId }, "CUSTOMER_CANCELLED", "Cancelled in Shopify", SYSTEM_META);
      await this.mutate(linked, ACCEPT_CANCELLATION, { id: node.id, message: `Posygo order ${request.order.reference} cancelled.` });
      await this.update(request.id, "CANCELLED", `Cancelled in Shopify. Posygo order ${request.order.reference} won't be sent.`);
    } catch (error) {
      if (error instanceof ShopifyApiError) {
        throw error;
      }
      await this.mutate(linked, REJECT_CANCELLATION, { id: node.id, message: `The hub has already packed Posygo order ${request.order.reference}, so it can't be cancelled now.` });
    }
  }

  private async reject(linked: LinkedShop, node: FulfilmentOrderNode, reason: string): Promise<void> {
    await this.mutate(linked, REJECT_FULFILMENT_REQUEST, { id: node.id, message: reason.slice(0, MESSAGE_LIMIT) });
    await this.record(linked, node, "REJECTED", reason, null);
  }

  private async assigned(linked: LinkedShop, status: "FULFILLMENT_REQUESTED" | "CANCELLATION_REQUESTED"): Promise<FulfilmentOrderNode[]> {
    const data = await this.shopify.graphql<AssignedFulfilmentOrders>(linked.shop.shopDomain, linked.accessToken, ASSIGNED_FULFILMENT_ORDERS, {
      status,
      locationIds: linked.shop.locationId ? [linked.shop.locationId] : null,
    });
    return data.assignedFulfillmentOrders.nodes;
  }

  private async mutate(linked: LinkedShop, mutation: string, variables: Record<string, unknown>): Promise<void> {
    const data = await this.shopify.graphql<MutationResult>(linked.shop.shopDomain, linked.accessToken, mutation, variables);
    const problem = userErrorMessage(Object.values(data)[0]?.userErrors);
    if (problem) {
      throw new ShopifyApiError(422, problem);
    }
  }

  private async record(linked: LinkedShop, node: FulfilmentOrderNode, outcome: ShopifyRequestOutcome, message: string, orderId: string | null): Promise<void> {
    const data = { outcome, message: message.slice(0, MESSAGE_LIMIT), orderId, orderName: node.orderName.slice(0, 60) };
    await this.prisma.shopifyFulfilmentRequest.upsert({ where: { fulfillmentOrderId: node.id }, create: { ...data, shopId: linked.shop.id, fulfillmentOrderId: node.id }, update: data });
  }

  private async update(id: string, outcome: ShopifyRequestOutcome, message: string): Promise<void> {
    await this.prisma.shopifyFulfilmentRequest.update({ where: { id }, data: { outcome, message: message.slice(0, MESSAGE_LIMIT) } });
  }

  private reason(error: unknown): string {
    if (error instanceof AppException) {
      const fields = error.fieldErrors ? Object.values(error.fieldErrors).flat() : [];
      return [error.message === "Some fields need attention." ? null : error.message, ...fields].filter(Boolean).join(" ") || "The order couldn't be created.";
    }
    this.logger.error(`Shopify order failed: ${error instanceof Error ? error.message : String(error)}`);
    return "Something went wrong on our side. Ask Posygo to look at it.";
  }
}
