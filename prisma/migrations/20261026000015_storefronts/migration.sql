ALTER TYPE "order_source" ADD VALUE 'STOREFRONT';
ALTER TYPE "ledger_entry_type" ADD VALUE 'STOREFRONT_FEE';

ALTER TABLE "ledger_entries" DROP CONSTRAINT "ledger_entries_sign_matches_type";
ALTER TABLE "ledger_entries" ADD CONSTRAINT "ledger_entries_sign_matches_type" CHECK (
  ("type"::text IN ('DEPOSIT', 'MANUAL_CREDIT', 'REFUND', 'REVERSAL', 'COMPENSATION') AND "amount_minor" > 0)
  OR ("type"::text IN ('ONBOARDING', 'STORAGE', 'FULFILMENT', 'SHIPPING', 'RETURN', 'RECEIVING_HOLD_FEE', 'MANUAL_DEBIT', 'PAYMENT_REVERSAL', 'STOREFRONT_FEE') AND "amount_minor" < 0)
);

ALTER TABLE "products"
  ADD COLUMN "listed" boolean NOT NULL DEFAULT false,
  ADD COLUMN "retail_price_minor" integer CHECK ("retail_price_minor" > 0 AND "retail_price_minor" <= 100000000),
  ADD COLUMN "description" varchar(2000),
  ADD COLUMN "category" varchar(60),
  ADD CONSTRAINT "products_listed_needs_price" CHECK (NOT "listed" OR "retail_price_minor" IS NOT NULL);
CREATE INDEX "products_listed_idx" ON "products" ("listed", "vendor_id") WHERE "listed";

CREATE TYPE "storefront_status" AS ENUM ('DRAFT', 'LIVE', 'PAUSED');

CREATE TABLE "storefronts" (
  "vendor_id" uuid PRIMARY KEY REFERENCES "vendors"("id") ON DELETE RESTRICT,
  "slug" varchar(40) NOT NULL UNIQUE CHECK ("slug" ~ '^[a-z0-9](?:[a-z0-9-]*[a-z0-9])$'),
  "display_name" varchar(80) NOT NULL,
  "about" varchar(2000),
  "tone" varchar(16) NOT NULL DEFAULT 'lime',
  "status" "storefront_status" NOT NULL DEFAULT 'DRAFT',
  "returns_allowed" boolean NOT NULL DEFAULT true,
  "return_window_days" integer NOT NULL DEFAULT 30 CHECK ("return_window_days" BETWEEN 1 AND 365),
  "setup_fee_paid_at" timestamptz(6),
  "created_at" timestamptz(6) NOT NULL DEFAULT now(),
  "updated_at" timestamptz(6) NOT NULL DEFAULT now(),
  CONSTRAINT "storefronts_live_paid" CHECK ("status" = 'DRAFT' OR "setup_fee_paid_at" IS NOT NULL)
);

CREATE TABLE "vendor_payout_accounts" (
  "vendor_id" uuid PRIMARY KEY REFERENCES "vendors"("id") ON DELETE RESTRICT,
  "provider" varchar(30) NOT NULL,
  "provider_account_id" varchar(120) NOT NULL,
  "status" "payout_account_status" NOT NULL DEFAULT 'ONBOARDING',
  "bank_summary" varchar(120),
  "bank_fingerprint" varchar(120),
  "details_changed_at" timestamptz(6),
  "created_at" timestamptz(6) NOT NULL DEFAULT now(),
  "updated_at" timestamptz(6) NOT NULL DEFAULT now(),
  CONSTRAINT "vendor_payout_accounts_provider_account" UNIQUE ("provider", "provider_account_id")
);

CREATE TABLE "buyer_accounts" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "email" varchar(254) NOT NULL UNIQUE CHECK ("email" = lower("email")),
  "name" varchar(120),
  "created_at" timestamptz(6) NOT NULL DEFAULT now(),
  "updated_at" timestamptz(6) NOT NULL DEFAULT now()
);

CREATE TABLE "buyer_login_tokens" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "buyer_id" uuid NOT NULL REFERENCES "buyer_accounts"("id") ON DELETE CASCADE,
  "token_hash" char(64) NOT NULL UNIQUE,
  "expires_at" timestamptz(6) NOT NULL,
  "consumed_at" timestamptz(6),
  "created_at" timestamptz(6) NOT NULL DEFAULT now()
);
CREATE INDEX "buyer_login_tokens_buyer_idx" ON "buyer_login_tokens" ("buyer_id", "created_at");

CREATE TABLE "buyer_sessions" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "buyer_id" uuid NOT NULL REFERENCES "buyer_accounts"("id") ON DELETE CASCADE,
  "token_hash" char(64) NOT NULL UNIQUE,
  "expires_at" timestamptz(6) NOT NULL,
  "revoked_at" timestamptz(6),
  "created_at" timestamptz(6) NOT NULL DEFAULT now()
);
CREATE INDEX "buyer_sessions_buyer_idx" ON "buyer_sessions" ("buyer_id");

CREATE TYPE "discount_kind" AS ENUM ('PERCENT', 'FIXED');

CREATE TABLE "discount_codes" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "vendor_id" uuid NOT NULL REFERENCES "vendors"("id") ON DELETE RESTRICT,
  "code" varchar(40) NOT NULL CHECK ("code" ~ '^[A-Z0-9][A-Z0-9-]{2,39}$'),
  "kind" "discount_kind" NOT NULL,
  "percent_bps" integer CHECK ("percent_bps" BETWEEN 1 AND 9000),
  "amount_minor" bigint CHECK ("amount_minor" > 0),
  "min_goods_minor" bigint NOT NULL DEFAULT 0 CHECK ("min_goods_minor" >= 0),
  "starts_at" timestamptz(6),
  "ends_at" timestamptz(6),
  "max_redemptions" integer CHECK ("max_redemptions" > 0),
  "redemptions" integer NOT NULL DEFAULT 0 CHECK ("redemptions" >= 0),
  "active" boolean NOT NULL DEFAULT true,
  "created_by" uuid NOT NULL REFERENCES "users"("id") ON DELETE RESTRICT,
  "created_at" timestamptz(6) NOT NULL DEFAULT now(),
  CONSTRAINT "discount_codes_value" CHECK (("kind" = 'PERCENT' AND "percent_bps" IS NOT NULL AND "amount_minor" IS NULL) OR ("kind" = 'FIXED' AND "amount_minor" IS NOT NULL AND "percent_bps" IS NULL)),
  CONSTRAINT "discount_codes_window" CHECK ("starts_at" IS NULL OR "ends_at" IS NULL OR "ends_at" > "starts_at"),
  CONSTRAINT "discount_codes_cap" CHECK ("max_redemptions" IS NULL OR "redemptions" <= "max_redemptions"),
  CONSTRAINT "discount_codes_vendor_code" UNIQUE ("vendor_id", "code")
);

CREATE TYPE "storefront_order_status" AS ENUM ('PENDING_PAYMENT', 'PAID', 'AWAITING_VENDOR_FUNDS', 'FULFILLING', 'SHIPPED', 'DELIVERED', 'CANCELLED', 'REFUNDED', 'PAYMENT_FAILED');
CREATE TYPE "vendor_payout_status" AS ENUM ('NONE', 'HELD', 'PENDING', 'PAID', 'FAILED', 'CANCELLED');

CREATE TABLE "storefront_orders" (
  "id" uuid PRIMARY KEY,
  "reference" varchar(24) NOT NULL UNIQUE,
  "vendor_id" uuid NOT NULL REFERENCES "vendors"("id") ON DELETE RESTRICT,
  "country_code" char(2) NOT NULL REFERENCES "countries"("code") ON DELETE RESTRICT,
  "currency" char(3) NOT NULL,
  "buyer_id" uuid REFERENCES "buyer_accounts"("id") ON DELETE RESTRICT,
  "buyer_email" varchar(254) NOT NULL,
  "buyer_name" varchar(120) NOT NULL,
  "recipient_encrypted" text NOT NULL,
  "recipient_city" varchar(60) NOT NULL,
  "destination_country_code" char(2) NOT NULL,
  "goods_minor" bigint NOT NULL CHECK ("goods_minor" > 0),
  "discount_code_id" uuid REFERENCES "discount_codes"("id") ON DELETE RESTRICT,
  "discount_minor" bigint NOT NULL DEFAULT 0 CHECK ("discount_minor" >= 0 AND "discount_minor" <= "goods_minor"),
  "delivery_speed" varchar(16) NOT NULL,
  "delivery_minor" bigint NOT NULL CHECK ("delivery_minor" >= 0),
  "tax_minor" bigint NOT NULL CHECK ("tax_minor" >= 0),
  "tax_included" boolean NOT NULL,
  "total_minor" bigint NOT NULL CHECK ("total_minor" > 0),
  "vendor_share_minor" bigint NOT NULL CHECK ("vendor_share_minor" >= 0),
  "platform_share_minor" bigint NOT NULL CHECK ("platform_share_minor" >= 0),
  "provider" varchar(20) NOT NULL,
  "provider_reference" varchar(255),
  "payment_id" varchar(255),
  "expires_at" timestamptz(6) NOT NULL,
  "paid_at" timestamptz(6),
  "status" "storefront_order_status" NOT NULL DEFAULT 'PENDING_PAYMENT',
  "fulfilment_order_id" uuid UNIQUE REFERENCES "orders"("id") ON DELETE RESTRICT,
  "payout_status" "vendor_payout_status" NOT NULL DEFAULT 'NONE',
  "payout_release_at" timestamptz(6),
  "payout_transfer_id" varchar(255),
  "payout_paid_at" timestamptz(6),
  "refunded_minor" bigint NOT NULL DEFAULT 0 CHECK ("refunded_minor" >= 0 AND "refunded_minor" <= "total_minor"),
  "created_at" timestamptz(6) NOT NULL DEFAULT now(),
  "updated_at" timestamptz(6) NOT NULL DEFAULT now(),
  CONSTRAINT "storefront_orders_split" CHECK ("vendor_share_minor" + "platform_share_minor" = "total_minor"),
  CONSTRAINT "storefront_orders_total" CHECK ("total_minor" = "goods_minor" - "discount_minor" + "delivery_minor" + CASE WHEN "tax_included" THEN 0 ELSE "tax_minor" END),
  CONSTRAINT "storefront_orders_paid" CHECK ("status" IN ('PENDING_PAYMENT', 'PAYMENT_FAILED', 'CANCELLED') OR "paid_at" IS NOT NULL),
  CONSTRAINT "storefront_orders_payout_paid" CHECK ("payout_status" <> 'PAID' OR ("payout_transfer_id" IS NOT NULL AND "payout_paid_at" IS NOT NULL))
);
CREATE INDEX "storefront_orders_vendor_idx" ON "storefront_orders" ("vendor_id", "created_at");
CREATE INDEX "storefront_orders_buyer_idx" ON "storefront_orders" ("buyer_email", "created_at");
CREATE INDEX "storefront_orders_payout_idx" ON "storefront_orders" ("payout_status", "payout_release_at");
CREATE UNIQUE INDEX "storefront_orders_payment_unique" ON "storefront_orders" ("provider", "payment_id") WHERE "payment_id" IS NOT NULL;

CREATE TABLE "storefront_order_lines" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "storefront_order_id" uuid NOT NULL REFERENCES "storefront_orders"("id") ON DELETE RESTRICT,
  "product_id" uuid NOT NULL REFERENCES "products"("id") ON DELETE RESTRICT,
  "product_name" varchar(120) NOT NULL,
  "quantity" integer NOT NULL CHECK ("quantity" BETWEEN 1 AND 999),
  "unit_price_minor" integer NOT NULL CHECK ("unit_price_minor" > 0),
  CONSTRAINT "storefront_order_lines_product" UNIQUE ("storefront_order_id", "product_id")
);

CREATE TYPE "storefront_return_status" AS ENUM ('REQUESTED', 'APPROVED', 'REJECTED', 'REFUNDED');

CREATE TABLE "storefront_returns" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "reference" varchar(24) NOT NULL UNIQUE,
  "storefront_order_id" uuid NOT NULL REFERENCES "storefront_orders"("id") ON DELETE RESTRICT,
  "status" "storefront_return_status" NOT NULL DEFAULT 'REQUESTED',
  "reason" varchar(1000) NOT NULL,
  "decided_by" uuid REFERENCES "users"("id") ON DELETE RESTRICT,
  "decided_at" timestamptz(6),
  "decision_note" varchar(1000),
  "refund_minor" bigint CHECK ("refund_minor" > 0),
  "provider_refund_id" varchar(255),
  "created_at" timestamptz(6) NOT NULL DEFAULT now(),
  CONSTRAINT "storefront_returns_decided" CHECK ("status" = 'REQUESTED' OR ("decided_by" IS NOT NULL AND "decided_at" IS NOT NULL)),
  CONSTRAINT "storefront_returns_refunded" CHECK ("status" <> 'REFUNDED' OR ("refund_minor" IS NOT NULL AND "provider_refund_id" IS NOT NULL))
);
CREATE UNIQUE INDEX "storefront_returns_one_open" ON "storefront_returns" ("storefront_order_id") WHERE "status" IN ('REQUESTED', 'APPROVED');

ALTER TABLE "orders" DROP CONSTRAINT "orders_created_by_someone";
ALTER TABLE "orders" ADD CONSTRAINT "orders_created_by_someone" CHECK ("created_by" IS NOT NULL OR "api_key_id" IS NOT NULL OR "source"::text = 'STOREFRONT');
