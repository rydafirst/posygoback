ALTER TYPE "movement_type" ADD VALUE 'RETURN_IN';
ALTER TYPE "custody_event_type" ADD VALUE 'RETURNED';

CREATE TYPE "vendor_return_status" AS ENUM ('REQUESTED', 'RECEIVED', 'INSTRUCTED', 'COMPLETED', 'CANCELLED', 'EXPIRED');

CREATE TABLE "vendor_returns" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "reference" varchar(24) NOT NULL UNIQUE,
  "vendor_id" uuid NOT NULL REFERENCES "vendors"("id") ON DELETE RESTRICT,
  "order_id" uuid NOT NULL REFERENCES "orders"("id") ON DELETE RESTRICT,
  "warehouse_id" uuid NOT NULL REFERENCES "warehouses"("id") ON DELETE RESTRICT,
  "country_code" char(2) NOT NULL REFERENCES "countries"("code") ON DELETE RESTRICT,
  "status" "vendor_return_status" NOT NULL DEFAULT 'REQUESTED',
  "reason" varchar(500) NOT NULL,
  "carrier" varchar(60),
  "tracking_number" varchar(64),
  "fee_minor" bigint NOT NULL CHECK ("fee_minor" >= 0),
  "currency" char(3) NOT NULL,
  "created_by" uuid NOT NULL REFERENCES "users"("id") ON DELETE RESTRICT,
  "received_by" uuid REFERENCES "users"("id") ON DELETE RESTRICT,
  "received_at" timestamptz(6),
  "receive_notes" varchar(1000),
  "photo_file_ids" jsonb NOT NULL DEFAULT '[]',
  "instructed_by" uuid REFERENCES "users"("id") ON DELETE RESTRICT,
  "instructed_at" timestamptz(6),
  "completed_by" uuid REFERENCES "users"("id") ON DELETE RESTRICT,
  "completed_at" timestamptz(6),
  "created_at" timestamptz(6) NOT NULL DEFAULT now(),
  "updated_at" timestamptz(6) NOT NULL DEFAULT now(),
  CONSTRAINT "vendor_returns_received" CHECK ("status" IN ('REQUESTED', 'CANCELLED', 'EXPIRED') OR ("received_by" IS NOT NULL AND "received_at" IS NOT NULL)),
  CONSTRAINT "vendor_returns_instructed" CHECK ("status" NOT IN ('INSTRUCTED', 'COMPLETED') OR "instructed_at" IS NOT NULL),
  CONSTRAINT "vendor_returns_completed" CHECK ("status" <> 'COMPLETED' OR ("completed_by" IS NOT NULL AND "completed_at" IS NOT NULL))
);
CREATE INDEX "vendor_returns_vendor_idx" ON "vendor_returns" ("vendor_id", "created_at");
CREATE INDEX "vendor_returns_warehouse_idx" ON "vendor_returns" ("warehouse_id", "status");
CREATE INDEX "vendor_returns_order_idx" ON "vendor_returns" ("order_id");

CREATE TABLE "vendor_return_lines" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "return_id" uuid NOT NULL REFERENCES "vendor_returns"("id") ON DELETE RESTRICT,
  "order_line_id" uuid NOT NULL REFERENCES "order_lines"("id") ON DELETE RESTRICT,
  "product_id" uuid NOT NULL REFERENCES "products"("id") ON DELETE RESTRICT,
  "requested_quantity" integer NOT NULL CHECK ("requested_quantity" > 0),
  "received_quantity" integer CHECK ("received_quantity" >= 0 AND "received_quantity" <= "requested_quantity"),
  "restock_quantity" integer NOT NULL DEFAULT 0 CHECK ("restock_quantity" >= 0),
  "dispose_quantity" integer NOT NULL DEFAULT 0 CHECK ("dispose_quantity" >= 0),
  "donate_quantity" integer NOT NULL DEFAULT 0 CHECK ("donate_quantity" >= 0),
  "restock_lot_id" uuid REFERENCES "stock_lots"("id") ON DELETE RESTRICT,
  CONSTRAINT "vendor_return_lines_split" CHECK ("restock_quantity" + "dispose_quantity" + "donate_quantity" <= COALESCE("received_quantity", 0)),
  CONSTRAINT "vendor_return_lines_unique" UNIQUE ("return_id", "order_line_id")
);
