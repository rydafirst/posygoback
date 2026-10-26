import { argon2id, hash } from "argon2";

import { loadConfig } from "../src/config/config.schema";
import { query } from "./partner-helpers";

export const SOURCE_SCHEMA = "usaerrands_source";
export const OLD_PASSWORD = "an old system password";

export const IDS = {
  vendor: "11111111-1111-4111-8111-111111111111",
  closedVendor: "22222222-2222-4222-8222-222222222222",
  ukVendor: "33333333-3333-4333-8333-333333333333",
  owner: "44444444-4444-4444-8444-444444444444",
  member: "55555555-5555-4555-8555-555555555555",
  admin: "66666666-6666-4666-8666-666666666666",
  wig: "77777777-7777-4777-8777-777777777777",
  bonnet: "88888888-8888-4888-8888-888888888888",
};

const TABLES = `
CREATE TABLE vendors (id uuid PRIMARY KEY, business_name text NOT NULL, country char(2) NOT NULL, status text NOT NULL, created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE users (id uuid PRIMARY KEY, email text NOT NULL, password_hash text NOT NULL, role text NOT NULL, vendor_id uuid, status text NOT NULL, email_verified boolean NOT NULL, created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE products (id uuid PRIMARY KEY, vendor_id uuid NOT NULL, code text NOT NULL, name text NOT NULL, variant text NOT NULL DEFAULT 'STD', hs_code text, country_of_origin char(2) NOT NULL,
  declared_value_cents int NOT NULL, weight_oz double precision NOT NULL, length_in double precision, width_in double precision, height_in double precision, storage_tier text NOT NULL, created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE product_barcodes (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), product_id uuid NOT NULL, barcode text NOT NULL, symbology text NOT NULL, is_primary boolean NOT NULL DEFAULT false, created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE inventory_locations (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), code text NOT NULL);
CREATE TABLE skus (id text PRIMARY KEY, vendor_id uuid NOT NULL, product_id uuid NOT NULL, quantity_available int NOT NULL, quantity_reserved int NOT NULL DEFAULT 0, status text NOT NULL, location_id uuid, created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE wallets (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), vendor_id uuid NOT NULL, balance_cents int NOT NULL);
CREATE TABLE orders (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), vendor_id uuid NOT NULL, status text NOT NULL);
CREATE TABLE psns (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), vendor_id uuid NOT NULL, status text NOT NULL);
CREATE TABLE shopper_requests (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), status text NOT NULL);
CREATE TABLE storefront_orders (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), vendor_id uuid NOT NULL, payout_status text NOT NULL);
`;

export function sourceUrl(): string {
  return loadConfig().DATABASE_URL;
}

export async function buildSource(): Promise<void> {
  const password = await hash(OLD_PASSWORD, { type: argon2id });
  await query(`DROP SCHEMA IF EXISTS ${SOURCE_SCHEMA} CASCADE; CREATE SCHEMA ${SOURCE_SCHEMA}; SET search_path TO ${SOURCE_SCHEMA}; ${TABLES}`);
  await query(
    `INSERT INTO ${SOURCE_SCHEMA}.vendors (id, business_name, country, status) VALUES ($1, 'Brooklyn Braids', 'US', 'ACTIVE'), ($2, 'Gone Ltd', 'US', 'CLOSED'), ($3, 'London Lace', 'GB', 'ACTIVE')`,
    [IDS.vendor, IDS.closedVendor, IDS.ukVendor],
  );
  await query(
    `INSERT INTO ${SOURCE_SCHEMA}.users (id, email, password_hash, role, vendor_id, status, email_verified) VALUES
     ($1, 'Owner@Braids.example', $4, 'VENDOR', $5, 'ACTIVE', true),
     ($2, 'helper@braids.example', $4, 'VENDOR_SUB_USER', $5, 'ACTIVE', true),
     ($3, 'old-admin@braids.example', $4, 'SUPER_ADMIN', $5, 'ACTIVE', true)`,
    [IDS.owner, IDS.member, IDS.admin, password, IDS.vendor],
  );
  await query(
    `INSERT INTO ${SOURCE_SCHEMA}.products (id, vendor_id, code, name, variant, hs_code, country_of_origin, declared_value_cents, weight_oz, length_in, width_in, height_in, storage_tier) VALUES
     ($1, $3, 'wig 22', 'Body wave wig 22 inch', 'STD', '6704.20', 'CN', 4500, 12.5, 10, 8, 4, 'SMALL'),
     ($2, $3, 'BONNET', 'Satin bonnet', 'Pink', NULL, 'US', 800, 2, NULL, NULL, NULL, 'SMALL')`,
    [IDS.wig, IDS.bonnet, IDS.vendor],
  );
  await query(`INSERT INTO ${SOURCE_SCHEMA}.product_barcodes (product_id, barcode, symbology, is_primary) VALUES ($1, '4006381333931', 'EAN13', true), ($1, 'bad code!', 'OTHER', false)`, [IDS.wig]);
  await query(
    `INSERT INTO ${SOURCE_SCHEMA}.skus (id, vendor_id, product_id, quantity_available, status) VALUES
     ('UER-1', $1, $2, 7, 'ACTIVE'), ('UER-2', $1, $2, 3, 'ACTIVE'), ('UER-3', $1, $2, 2, 'DAMAGED'), ('UER-4', $1, $3, 0, 'OUT_OF_STOCK')`,
    [IDS.vendor, IDS.wig, IDS.bonnet],
  );
  await query(`INSERT INTO ${SOURCE_SCHEMA}.wallets (vendor_id, balance_cents) VALUES ($1, 12345), ($2, -500)`, [IDS.vendor, IDS.closedVendor]);
  await query(`INSERT INTO ${SOURCE_SCHEMA}.orders (vendor_id, status) VALUES ($1, 'DELIVERED'), ($1, 'CANCELLED')`, [IDS.vendor]);
}
