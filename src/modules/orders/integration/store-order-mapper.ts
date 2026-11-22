import { type IntegrationOrderInput, integrationOrderSchema, recipientSchema, type StorePlatform } from "../../../shared";

export type MappedStoreOrder = { kind: "order"; order: IntegrationOrderInput } | { kind: "skip"; externalReference: string | null; reason: string };

interface ShopifyAddress {
  name?: string;
  first_name?: string;
  last_name?: string;
  company?: string | null;
  address1?: string;
  address2?: string | null;
  city?: string;
  province_code?: string | null;
  zip?: string;
  country_code?: string;
  phone?: string | null;
}

interface ShopifyOrder {
  order_number?: number;
  name?: string;
  financial_status?: string;
  cancelled_at?: string | null;
  email?: string | null;
  phone?: string | null;
  shipping_address?: ShopifyAddress | null;
  line_items?: Array<{ sku?: string | null; quantity?: number; requires_shipping?: boolean; title?: string }>;
}

interface WooAddress {
  first_name?: string;
  last_name?: string;
  company?: string;
  address_1?: string;
  address_2?: string;
  city?: string;
  state?: string;
  postcode?: string;
  country?: string;
  phone?: string;
  email?: string;
}

interface WooOrder {
  id?: number;
  number?: string;
  status?: string;
  billing?: WooAddress;
  shipping?: WooAddress;
  line_items?: Array<{ sku?: string; quantity?: number; name?: string }>;
}

export interface StoreOrderDraft {
  externalReference: string;
  name: string;
  company?: string;
  line1: string;
  line2?: string;
  city: string;
  region?: string;
  postalCode: string;
  country: string;
  phone?: string;
  email?: string;
  lines: Array<{ sku: string | null | undefined; quantity: number; title: string }>;
}

const SHOPIFY_PAID = new Set(["paid", "partially_paid"]);
const WOO_READY = new Set(["processing", "completed"]);

export function mapStoreOrder(platform: StorePlatform, payload: unknown): MappedStoreOrder {
  return platform === "SHOPIFY" ? fromShopify(payload as ShopifyOrder) : fromWoo(payload as WooOrder);
}

function fromShopify(order: ShopifyOrder): MappedStoreOrder {
  const reference = order.order_number ? `SHOPIFY-${order.order_number}` : null;
  if (!reference) {
    return { kind: "skip", externalReference: null, reason: "This doesn't look like a Shopify order." };
  }
  if (order.cancelled_at) {
    return { kind: "skip", externalReference: reference, reason: "The order was cancelled in Shopify." };
  }
  if (!SHOPIFY_PAID.has(order.financial_status ?? "")) {
    return { kind: "skip", externalReference: reference, reason: "Not paid yet. It comes through once the customer has paid." };
  }
  const address = order.shipping_address;
  if (!address) {
    return { kind: "skip", externalReference: reference, reason: "No delivery address, so there's nothing to send." };
  }
  return buildStoreOrder({
    externalReference: reference,
    name: address.name || [address.first_name, address.last_name].filter(Boolean).join(" "),
    company: address.company ?? undefined,
    line1: address.address1 ?? "",
    line2: address.address2 ?? undefined,
    city: address.city ?? "",
    region: address.province_code ?? undefined,
    postalCode: address.zip ?? "",
    country: address.country_code ?? "",
    phone: address.phone ?? order.phone ?? undefined,
    email: order.email ?? undefined,
    lines: (order.line_items ?? []).filter((line) => line.requires_shipping !== false).map((line) => ({ sku: line.sku, quantity: line.quantity ?? 0, title: line.title ?? "an item" })),
  });
}

function fromWoo(order: WooOrder): MappedStoreOrder {
  const number = order.number ?? (order.id ? String(order.id) : null);
  if (!number) {
    return { kind: "skip", externalReference: null, reason: "Test message from WooCommerce received. You're connected." };
  }
  const reference = `WOO-${number}`;
  if (!WOO_READY.has(order.status ?? "")) {
    return { kind: "skip", externalReference: reference, reason: "Not paid yet. It comes through once the order is Processing." };
  }
  const address = order.shipping?.address_1 ? order.shipping : order.billing;
  if (!address?.address_1) {
    return { kind: "skip", externalReference: reference, reason: "No delivery address, so there's nothing to send." };
  }
  return buildStoreOrder({
    externalReference: reference,
    name: [address.first_name, address.last_name].filter(Boolean).join(" "),
    company: address.company || undefined,
    line1: address.address_1,
    line2: address.address_2 || undefined,
    city: address.city ?? "",
    region: address.state || undefined,
    postalCode: address.postcode ?? "",
    country: address.country ?? "",
    phone: address.phone || order.billing?.phone || undefined,
    email: order.billing?.email || undefined,
    lines: (order.line_items ?? []).map((line) => ({ sku: line.sku, quantity: line.quantity ?? 0, title: line.name ?? "an item" })),
  });
}

export function buildStoreOrder(draft: StoreOrderDraft): MappedStoreOrder {
  const missing = draft.lines.find((line) => !line.sku?.trim());
  if (missing) {
    return { kind: "skip", externalReference: draft.externalReference, reason: `"${missing.title}" has no SKU. Set its SKU to the Posygo product code.` };
  }
  const quantities = new Map<string, number>();
  for (const line of draft.lines) {
    const code = line.sku!.trim().toUpperCase();
    quantities.set(code, (quantities.get(code) ?? 0) + line.quantity);
  }
  const phone = recipientSchema.shape.phone.safeParse(draft.phone).success ? draft.phone : undefined;
  const email = recipientSchema.shape.email.safeParse(draft.email).success ? draft.email : undefined;
  const parsed = integrationOrderSchema.safeParse({
    country: draft.country.toUpperCase(),
    externalReference: draft.externalReference,
    recipient: {
      name: draft.name,
      company: draft.company || undefined,
      line1: draft.line1,
      line2: draft.line2 || undefined,
      city: draft.city,
      region: draft.region || undefined,
      postalCode: draft.postalCode,
      phone,
      email,
    },
    lines: [...quantities].map(([productCode, quantity]) => ({ productCode, quantity })),
  });
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    return { kind: "skip", externalReference: draft.externalReference, reason: `The order couldn't be read: ${issue?.path.join(".") || "order"} ${issue?.message ?? "is invalid"}.`.slice(0, 280) };
  }
  return { kind: "order", order: parsed.data };
}
