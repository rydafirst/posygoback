import { buildStoreOrder, type MappedStoreOrder } from "../orders/integration/store-order-mapper";

export interface FulfilmentOrderNode {
  id: string;
  orderName: string;
  destination: {
    firstName?: string | null;
    lastName?: string | null;
    company?: string | null;
    address1?: string | null;
    address2?: string | null;
    city?: string | null;
    province?: string | null;
    zip?: string | null;
    countryCode?: string | null;
    phone?: string | null;
    email?: string | null;
  } | null;
  lineItems: { nodes: Array<{ sku?: string | null; remainingQuantity: number; productTitle?: string | null; requiresShipping?: boolean | null }> };
}

export interface AssignedFulfilmentOrders {
  assignedFulfillmentOrders: { nodes: FulfilmentOrderNode[] };
}

export function externalReferenceFor(orderName: string): string {
  return `SHOPIFY-${orderName.replace(/^#/, "").replace(/[^A-Za-z0-9_-]/g, "")}`.slice(0, 64);
}

export function mapFulfilmentOrder(node: FulfilmentOrderNode): MappedStoreOrder {
  const reference = externalReferenceFor(node.orderName);
  const destination = node.destination;
  if (!destination?.address1) {
    return { kind: "skip", externalReference: reference, reason: "No delivery address, so there's nothing to send." };
  }
  const lines = node.lineItems.nodes.filter((line) => line.requiresShipping !== false && line.remainingQuantity > 0);
  if (lines.length === 0) {
    return { kind: "skip", externalReference: reference, reason: "Nothing left in this order needs shipping." };
  }
  return buildStoreOrder({
    externalReference: reference,
    name: [destination.firstName, destination.lastName].filter(Boolean).join(" "),
    company: destination.company ?? undefined,
    line1: destination.address1,
    line2: destination.address2 ?? undefined,
    city: destination.city ?? "",
    region: destination.province ?? undefined,
    postalCode: destination.zip ?? "",
    country: destination.countryCode ?? "",
    phone: destination.phone ?? undefined,
    email: destination.email ?? undefined,
    lines: lines.map((line) => ({ sku: line.sku, quantity: line.remainingQuantity, title: line.productTitle ?? "an item" })),
  });
}
