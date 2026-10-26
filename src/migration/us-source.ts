import { Pool, type PoolClient } from "pg";

import type { SourceRole, SourceTier } from "./us-mapping";

export interface SourceVendor {
  id: string;
  businessName: string;
  status: string;
}

export interface SourceUser {
  id: string;
  email: string;
  passwordHash: string;
  role: SourceRole;
  vendorId: string | null;
  status: string;
  emailVerified: boolean;
}

export interface SourceProduct {
  id: string;
  vendorId: string;
  code: string;
  name: string;
  variant: string;
  hsCode: string | null;
  countryOfOrigin: string;
  declaredValueCents: number;
  weightOz: number;
  lengthIn: number | null;
  widthIn: number | null;
  heightIn: number | null;
  storageTier: SourceTier;
  barcodes: Array<{ value: string; symbology: string }>;
}

export interface SourceStock {
  skuId: string;
  vendorId: string;
  productId: string;
  quantityAvailable: number;
  quantityReserved: number;
  status: string;
  locationCode: string | null;
}

export interface SourceBlockers {
  ordersInProgress: number;
  inboundsOpen: number;
  shoppingOpen: number;
  storePayoutsOwed: number;
}

export interface SourceSnapshot {
  vendors: SourceVendor[];
  users: SourceUser[];
  products: SourceProduct[];
  stock: SourceStock[];
  wallets: Map<string, number>;
  blockers: SourceBlockers;
  takenAt: Date;
}

const ORDERS_IN_PROGRESS = [
  "SUBMITTED",
  "ON_HOLD",
  "ALLOCATED",
  "LABEL_PURCHASED",
  "PICKING",
  "PACKED",
  "EXCEPTION",
  "PENDING_PACKING",
  "PACKING_COMPLETED",
  "AWAITING_SHIPPING_SELECTION",
  "AWAITING_WALLET_FUNDING",
  "SHIPPING_PAID",
];
const INBOUNDS_OPEN = ["SUBMITTED", "AWAITING_RECEIPT", "PARTIALLY_RECEIVED", "DISCREPANCY", "HOLD", "RETURN_REQUESTED"];
const SHOPPING_DONE = ["DELIVERED", "CANCELLED", "REFUNDED", "SHIPPED"];
const PAYOUTS_OWED = ["HELD", "PENDING", "FAILED"];
const SCHEMA_NAME = /^[a-z_][a-z0-9_]{0,62}$/;

async function rows<T>(client: PoolClient, text: string, values: unknown[] = []): Promise<T[]> {
  return (await client.query(text, values)).rows as T[];
}

async function count(client: PoolClient, text: string, values: unknown[]): Promise<number> {
  return Number((await rows<{ count: string }>(client, text, values))[0]!.count);
}

export async function readUsSnapshot(connectionString: string, schema = "public"): Promise<SourceSnapshot> {
  if (!SCHEMA_NAME.test(schema)) {
    throw new Error("Source schema name isn't valid");
  }
  const pool = new Pool({ connectionString, max: 1 });
  const client = await pool.connect();
  try {
    await client.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
    await client.query(`SET LOCAL search_path TO ${schema}`);
    const vendors = await rows<SourceVendor>(client, `SELECT id, business_name AS "businessName", status::text FROM vendors WHERE country = 'US' AND status::text <> 'CLOSED' ORDER BY created_at`);
    const ids = vendors.map((vendor) => vendor.id);
    const users = await rows<SourceUser>(
      client,
      `SELECT id, lower(email) AS email, password_hash AS "passwordHash", role::text AS role, vendor_id AS "vendorId", status::text, email_verified AS "emailVerified"
       FROM users WHERE vendor_id = ANY($1::uuid[]) ORDER BY created_at`,
      [ids],
    );
    const products = await rows<Omit<SourceProduct, "barcodes">>(
      client,
      `SELECT id, vendor_id AS "vendorId", code, name, variant, hs_code AS "hsCode", country_of_origin AS "countryOfOrigin", declared_value_cents AS "declaredValueCents",
              weight_oz AS "weightOz", length_in AS "lengthIn", width_in AS "widthIn", height_in AS "heightIn", storage_tier::text AS "storageTier"
       FROM products WHERE vendor_id = ANY($1::uuid[]) ORDER BY created_at`,
      [ids],
    );
    const barcodes = await rows<{ productId: string; value: string; symbology: string }>(
      client,
      `SELECT b.product_id AS "productId", b.barcode AS value, b.symbology::text AS symbology FROM product_barcodes b JOIN products p ON p.id = b.product_id
       WHERE p.vendor_id = ANY($1::uuid[]) ORDER BY b.is_primary DESC, b.created_at`,
      [ids],
    );
    const stock = await rows<SourceStock>(
      client,
      `SELECT s.id AS "skuId", s.vendor_id AS "vendorId", s.product_id AS "productId", s.quantity_available AS "quantityAvailable", s.quantity_reserved AS "quantityReserved",
              s.status::text, l.code AS "locationCode"
       FROM skus s LEFT JOIN inventory_locations l ON l.id = s.location_id
       WHERE s.vendor_id = ANY($1::uuid[]) AND (s.quantity_available > 0 OR s.quantity_reserved > 0) ORDER BY s.created_at`,
      [ids],
    );
    const wallets = await rows<{ vendorId: string; balanceCents: number }>(client, `SELECT vendor_id AS "vendorId", balance_cents AS "balanceCents" FROM wallets WHERE vendor_id = ANY($1::uuid[])`, [
      ids,
    ]);
    const blockers: SourceBlockers = {
      ordersInProgress: await count(client, "SELECT count(*) FROM orders WHERE vendor_id = ANY($1::uuid[]) AND status::text = ANY($2::text[])", [ids, ORDERS_IN_PROGRESS]),
      inboundsOpen: await count(client, "SELECT count(*) FROM psns WHERE vendor_id = ANY($1::uuid[]) AND status::text = ANY($2::text[])", [ids, INBOUNDS_OPEN]),
      shoppingOpen: await count(client, "SELECT count(*) FROM shopper_requests WHERE NOT (status::text = ANY($1::text[]))", [SHOPPING_DONE]),
      storePayoutsOwed: await count(client, "SELECT count(*) FROM storefront_orders WHERE vendor_id = ANY($1::uuid[]) AND payout_status = ANY($2::text[])", [ids, PAYOUTS_OWED]),
    };
    await client.query("COMMIT");
    const byProduct = new Map<string, Array<{ value: string; symbology: string }>>();
    for (const barcode of barcodes) {
      byProduct.set(barcode.productId, [...(byProduct.get(barcode.productId) ?? []), { value: barcode.value, symbology: barcode.symbology }]);
    }
    return {
      vendors,
      users,
      products: products.map((product) => ({ ...product, weightOz: Number(product.weightOz), barcodes: byProduct.get(product.id) ?? [] })),
      stock,
      wallets: new Map(wallets.map((wallet) => [wallet.vendorId, Number(wallet.balanceCents)])),
      blockers,
      takenAt: new Date(),
    };
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    client.release();
    await pool.end();
  }
}
