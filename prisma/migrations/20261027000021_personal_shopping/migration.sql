CREATE TYPE "shopping_status" AS ENUM ('REQUESTED', 'QUOTED', 'PAID', 'BUYING', 'ARRIVED', 'SHIPPED', 'DELIVERED', 'CANCELLED', 'EXPIRED');
CREATE TYPE "shopping_line_status" AS ENUM ('REQUESTED', 'QUOTED', 'UNAVAILABLE', 'BOUGHT', 'OUT_OF_STOCK', 'RECEIVED');

CREATE TABLE "shopping_requests" (
  "id" uuid PRIMARY KEY,
  "reference" varchar(24) NOT NULL UNIQUE,
  "country_code" char(2) NOT NULL REFERENCES "countries"("code") ON DELETE RESTRICT,
  "currency" char(3) NOT NULL,
  "buyer_id" uuid NOT NULL REFERENCES "buyer_accounts"("id") ON DELETE RESTRICT,
  "buyer_email" varchar(254) NOT NULL,
  "buyer_name" varchar(120) NOT NULL,
  "recipient_encrypted" text NOT NULL,
  "recipient_city" varchar(60) NOT NULL,
  "destination_country_code" char(2) NOT NULL,
  "notes" varchar(1000),
  "status" "shopping_status" NOT NULL DEFAULT 'REQUESTED',
  "warehouse_id" uuid REFERENCES "warehouses"("id") ON DELETE RESTRICT,
  "goods_minor" bigint NOT NULL DEFAULT 0 CHECK ("goods_minor" >= 0),
  "commission_minor" bigint NOT NULL DEFAULT 0 CHECK ("commission_minor" >= 0),
  "delivery_minor" bigint NOT NULL DEFAULT 0 CHECK ("delivery_minor" >= 0),
  "total_minor" bigint NOT NULL DEFAULT 0 CHECK ("total_minor" >= 0),
  "parcel" jsonb,
  "quote_expires_at" timestamptz(6),
  "quoted_by" uuid REFERENCES "users"("id") ON DELETE RESTRICT,
  "quoted_at" timestamptz(6),
  "provider" varchar(20),
  "provider_reference" varchar(255),
  "payment_id" varchar(255),
  "paid_at" timestamptz(6),
  "refunded_minor" bigint NOT NULL DEFAULT 0 CHECK ("refunded_minor" >= 0 AND "refunded_minor" <= "total_minor"),
  "arrival_photo_file_ids" jsonb NOT NULL DEFAULT '[]',
  "received_by" uuid REFERENCES "users"("id") ON DELETE RESTRICT,
  "carrier" varchar(60),
  "tracking_number" varchar(64),
  "tracking_url" varchar(500),
  "label_url" varchar(500),
  "shipped_by" uuid REFERENCES "users"("id") ON DELETE RESTRICT,
  "shipped_at" timestamptz(6),
  "delivered_at" timestamptz(6),
  "cancel_reason" varchar(300),
  "created_at" timestamptz(6) NOT NULL DEFAULT now(),
  "updated_at" timestamptz(6) NOT NULL DEFAULT now(),
  CONSTRAINT "shopping_requests_total" CHECK ("total_minor" = "goods_minor" + "commission_minor" + "delivery_minor"),
  CONSTRAINT "shopping_requests_quoted" CHECK ("status" IN ('REQUESTED', 'CANCELLED') OR ("quoted_at" IS NOT NULL AND "quoted_by" IS NOT NULL AND "total_minor" > 0 AND "warehouse_id" IS NOT NULL)),
  CONSTRAINT "shopping_requests_paid" CHECK ("status" NOT IN ('PAID', 'BUYING', 'ARRIVED', 'SHIPPED', 'DELIVERED') OR ("paid_at" IS NOT NULL AND "payment_id" IS NOT NULL)),
  CONSTRAINT "shopping_requests_shipped" CHECK ("status" NOT IN ('SHIPPED', 'DELIVERED') OR ("shipped_at" IS NOT NULL AND "tracking_number" IS NOT NULL))
);
CREATE UNIQUE INDEX "shopping_requests_payment" ON "shopping_requests" ("provider", "payment_id") WHERE "payment_id" IS NOT NULL;
CREATE INDEX "shopping_requests_status_idx" ON "shopping_requests" ("country_code", "status", "created_at");
CREATE INDEX "shopping_requests_buyer_idx" ON "shopping_requests" ("buyer_id", "created_at");

CREATE TABLE "shopping_lines" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "request_id" uuid NOT NULL REFERENCES "shopping_requests"("id") ON DELETE CASCADE,
  "position" integer NOT NULL,
  "url" varchar(2000) NOT NULL CHECK ("url" ~ '^https://'),
  "description" varchar(300) NOT NULL,
  "quantity" integer NOT NULL CHECK ("quantity" BETWEEN 1 AND 99),
  "status" "shopping_line_status" NOT NULL DEFAULT 'REQUESTED',
  "unit_price_minor" bigint CHECK ("unit_price_minor" > 0),
  "unit_weight_grams" integer CHECK ("unit_weight_grams" > 0),
  "hs_code" varchar(10),
  "staff_note" varchar(300),
  "retailer_order_ref" varchar(80),
  "received_quantity" integer CHECK ("received_quantity" >= 0 AND "received_quantity" <= "quantity"),
  CONSTRAINT "shopping_lines_priced" CHECK ("status" IN ('REQUESTED', 'UNAVAILABLE') OR "unit_price_minor" IS NOT NULL),
  CONSTRAINT "shopping_lines_position" UNIQUE ("request_id", "position")
);

CREATE TABLE "shopping_refunds" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "request_id" uuid NOT NULL REFERENCES "shopping_requests"("id") ON DELETE RESTRICT,
  "intent_key" varchar(120) NOT NULL UNIQUE,
  "amount_minor" bigint NOT NULL CHECK ("amount_minor" > 0),
  "status" varchar(16) NOT NULL DEFAULT 'PENDING' CHECK ("status" IN ('PENDING', 'SUCCEEDED', 'FAILED')),
  "provider_refund_id" varchar(255) UNIQUE,
  "reason" varchar(300) NOT NULL,
  "created_at" timestamptz(6) NOT NULL DEFAULT now(),
  "updated_at" timestamptz(6) NOT NULL DEFAULT now(),
  CONSTRAINT "shopping_refunds_settled" CHECK ("status" <> 'SUCCEEDED' OR "provider_refund_id" IS NOT NULL)
);
CREATE INDEX "shopping_refunds_request_idx" ON "shopping_refunds" ("request_id");
