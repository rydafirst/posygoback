CREATE TYPE "order_status" AS ENUM ('PENDING_PACKING', 'PACKING_COMPLETED', 'AWAITING_SHIPPING_SELECTION', 'AWAITING_WALLET_FUNDING', 'SHIPPING_PAID', 'LABEL_PURCHASED', 'HANDED_OFF', 'IN_TRANSIT', 'DELIVERED', 'ON_HOLD', 'EXCEPTION', 'CANCELLED', 'RETURNED');
CREATE TYPE "order_source" AS ENUM ('PORTAL', 'CSV', 'API');
CREATE TYPE "order_event_source" AS ENUM ('VENDOR', 'STAFF', 'SYSTEM', 'CARRIER');
CREATE TYPE "packaging_kind" AS ENUM ('BOX', 'MAILER');
CREATE TYPE "cancellation_status" AS ENUM ('PENDING', 'APPROVED', 'REJECTED');
CREATE TYPE "cancellation_reason" AS ENUM ('CUSTOMER_CANCELLED', 'WRONG_ITEMS', 'ADDRESS_PROBLEM', 'OUT_OF_STOCK', 'OTHER');

ALTER TYPE "custody_event_type" ADD VALUE 'PICKED';
ALTER TYPE "custody_event_type" ADD VALUE 'PACKED';
ALTER TYPE "custody_event_type" ADD VALUE 'HANDED_OFF';
ALTER TYPE "custody_event_type" ADD VALUE 'RELEASED';

ALTER TABLE "custody_events" ALTER COLUMN "actor_id" DROP NOT NULL;

CREATE OR REPLACE FUNCTION custody_event_digest(event custody_events, previous char(64))
RETURNS char(64)
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT encode(
    digest(
      concat_ws(
        '|',
        previous,
        event.sequence::text,
        event.id::text,
        event.warehouse_id::text,
        event.vendor_id::text,
        event.lot_id::text,
        event.type::text,
        event.quantity::text,
        coalesce(event.from_location_id::text, ''),
        coalesce(event.to_location_id::text, ''),
        coalesce(event.actor_id::text, 'system'),
        event.evidence_file_ids::text,
        to_char(event.created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US')
      ),
      'sha256'
    ),
    'hex'
  )::char(64);
$$;

CREATE TABLE "packaging_presets" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "country_code" char(2) NOT NULL REFERENCES "countries"("code") ON DELETE RESTRICT,
  "code" varchar(24) NOT NULL,
  "label" varchar(60) NOT NULL,
  "kind" "packaging_kind" NOT NULL,
  "length_mm" integer NOT NULL CHECK ("length_mm" > 0),
  "width_mm" integer NOT NULL CHECK ("width_mm" > 0),
  "height_mm" integer NOT NULL CHECK ("height_mm" > 0),
  "active" boolean NOT NULL DEFAULT true,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "packaging_presets_code_unique" UNIQUE ("country_code", "code")
);

CREATE TABLE "api_keys" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "vendor_id" uuid NOT NULL REFERENCES "vendors"("id") ON DELETE RESTRICT,
  "name" varchar(60) NOT NULL,
  "key_id" char(16) NOT NULL,
  "secret_hash" char(64) NOT NULL,
  "created_by" uuid NOT NULL REFERENCES "users"("id") ON DELETE RESTRICT,
  "last_used_at" timestamptz,
  "revoked_at" timestamptz,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "api_keys_key_id_unique" UNIQUE ("key_id")
);
CREATE INDEX "api_keys_vendor_idx" ON "api_keys" ("vendor_id", "revoked_at");

CREATE TABLE "orders" (
  "id" uuid PRIMARY KEY,
  "reference" varchar(20) NOT NULL,
  "vendor_id" uuid NOT NULL REFERENCES "vendors"("id") ON DELETE RESTRICT,
  "warehouse_id" uuid NOT NULL REFERENCES "warehouses"("id") ON DELETE RESTRICT,
  "origin_country_code" char(2) NOT NULL REFERENCES "countries"("code") ON DELETE RESTRICT,
  "destination_country_code" char(2) NOT NULL REFERENCES "countries"("code") ON DELETE RESTRICT,
  "status" "order_status" NOT NULL DEFAULT 'PENDING_PACKING',
  "source" "order_source" NOT NULL,
  "external_reference" varchar(64),
  "group_id" uuid NOT NULL,
  "recipient_encrypted" text NOT NULL,
  "recipient_name" varchar(100) NOT NULL,
  "recipient_city" varchar(60) NOT NULL,
  "customs_required" boolean NOT NULL,
  "currency" char(3) NOT NULL,
  "fee_schedule_id" uuid NOT NULL REFERENCES "fee_schedules"("id") ON DELETE RESTRICT,
  "fulfilment_fee_minor" bigint NOT NULL CHECK ("fulfilment_fee_minor" >= 0),
  "shipping_cost_minor" bigint CHECK ("shipping_cost_minor" >= 0),
  "shipping_charge_minor" bigint CHECK ("shipping_charge_minor" >= 0),
  "refunded_minor" bigint NOT NULL DEFAULT 0 CHECK ("refunded_minor" >= 0),
  "hold_reason" varchar(500),
  "status_before_hold" "order_status",
  "packaging_preset_id" uuid REFERENCES "packaging_presets"("id") ON DELETE RESTRICT,
  "packed_length_mm" integer,
  "packed_width_mm" integer,
  "packed_height_mm" integer,
  "packed_weight_grams" integer,
  "pack_notes" varchar(500),
  "packed_by" uuid REFERENCES "users"("id") ON DELETE RESTRICT,
  "packed_at" timestamptz,
  "selected_rate_id" uuid,
  "carrier" varchar(60),
  "carrier_code" varchar(40),
  "carrier_service" varchar(120),
  "tracking_number" varchar(64),
  "tracking_url" varchar(500),
  "label_url" varchar(1000),
  "label_transaction_id" varchar(120),
  "label_purchased_by" uuid REFERENCES "users"("id") ON DELETE RESTRICT,
  "label_purchased_at" timestamptz,
  "label_void_requested_at" timestamptz,
  "handed_off_at" timestamptz,
  "delivered_at" timestamptz,
  "cancelled_at" timestamptz,
  "cancel_reason" "cancellation_reason",
  "cancel_note" varchar(500),
  "created_by" uuid REFERENCES "users"("id") ON DELETE RESTRICT,
  "api_key_id" uuid REFERENCES "api_keys"("id") ON DELETE RESTRICT,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "orders_reference_unique" UNIQUE ("reference"),
  CONSTRAINT "orders_pack_complete" CHECK (
    ("packed_length_mm" IS NULL AND "packed_width_mm" IS NULL AND "packed_height_mm" IS NULL AND "packed_weight_grams" IS NULL)
    OR ("packed_length_mm" > 0 AND "packed_width_mm" > 0 AND "packed_height_mm" > 0 AND "packed_weight_grams" > 0)
  ),
  CONSTRAINT "orders_created_by_someone" CHECK ("created_by" IS NOT NULL OR "api_key_id" IS NOT NULL)
);
CREATE UNIQUE INDEX "orders_external_reference_unique" ON "orders" ("vendor_id", "external_reference") WHERE "external_reference" IS NOT NULL;
CREATE UNIQUE INDEX "orders_tracking_unique" ON "orders" ("carrier_code", "tracking_number") WHERE "tracking_number" IS NOT NULL;
CREATE INDEX "orders_vendor_idx" ON "orders" ("vendor_id", "created_at" DESC);
CREATE INDEX "orders_warehouse_status_idx" ON "orders" ("warehouse_id", "status");
CREATE INDEX "orders_tracking_number_idx" ON "orders" ("tracking_number");
CREATE INDEX "orders_source_day_idx" ON "orders" ("vendor_id", "source", "created_at");

CREATE TABLE "order_lines" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "order_id" uuid NOT NULL REFERENCES "orders"("id") ON DELETE RESTRICT,
  "product_id" uuid NOT NULL REFERENCES "products"("id") ON DELETE RESTRICT,
  "product_code" varchar(40) NOT NULL,
  "product_name" varchar(120) NOT NULL,
  "quantity" integer NOT NULL CHECK ("quantity" > 0),
  "scanned_quantity" integer NOT NULL DEFAULT 0,
  "unit_value_minor" integer NOT NULL CHECK ("unit_value_minor" >= 0),
  "unit_weight_grams" integer NOT NULL,
  "hs_code" varchar(10),
  "country_of_origin" char(2) NOT NULL,
  CONSTRAINT "order_lines_scan_bounds" CHECK ("scanned_quantity" BETWEEN 0 AND "quantity"),
  CONSTRAINT "order_lines_product_unique" UNIQUE ("order_id", "product_id")
);

CREATE TABLE "order_allocations" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "order_id" uuid NOT NULL REFERENCES "orders"("id") ON DELETE RESTRICT,
  "line_id" uuid NOT NULL REFERENCES "order_lines"("id") ON DELETE RESTRICT,
  "lot_id" uuid NOT NULL REFERENCES "stock_lots"("id") ON DELETE RESTRICT,
  "quantity" integer NOT NULL CHECK ("quantity" > 0),
  "released_at" timestamptz,
  "shipped_at" timestamptz
);
CREATE INDEX "order_allocations_order_idx" ON "order_allocations" ("order_id");
CREATE INDEX "order_allocations_lot_idx" ON "order_allocations" ("lot_id");

CREATE TABLE "order_rate_quotes" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "order_id" uuid NOT NULL REFERENCES "orders"("id") ON DELETE RESTRICT,
  "provider_rate_id" varchar(120) NOT NULL,
  "carrier" varchar(60) NOT NULL,
  "carrier_code" varchar(40) NOT NULL,
  "service" varchar(120) NOT NULL,
  "currency" char(3) NOT NULL,
  "cost_minor" bigint NOT NULL CHECK ("cost_minor" >= 0),
  "charge_minor" bigint NOT NULL CHECK ("charge_minor" >= "cost_minor"),
  "estimated_days" integer,
  "superseded_at" timestamptz,
  "created_at" timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX "order_rate_quotes_order_idx" ON "order_rate_quotes" ("order_id", "superseded_at");
ALTER TABLE "orders" ADD CONSTRAINT "orders_selected_rate_fk" FOREIGN KEY ("selected_rate_id") REFERENCES "order_rate_quotes"("id") ON DELETE RESTRICT;

CREATE TABLE "order_events" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "order_id" uuid NOT NULL REFERENCES "orders"("id") ON DELETE RESTRICT,
  "type" varchar(60) NOT NULL,
  "description" varchar(500) NOT NULL,
  "source" "order_event_source" NOT NULL,
  "actor_id" uuid REFERENCES "users"("id") ON DELETE RESTRICT,
  "location" varchar(120),
  "dedupe_key" varchar(120),
  "occurred_at" timestamptz NOT NULL DEFAULT now(),
  "created_at" timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX "order_events_order_idx" ON "order_events" ("order_id", "occurred_at");
CREATE UNIQUE INDEX "order_events_dedupe_unique" ON "order_events" ("order_id", "dedupe_key") WHERE "dedupe_key" IS NOT NULL;
CREATE TRIGGER "order_events_no_update" BEFORE UPDATE OR DELETE ON "order_events" FOR EACH ROW EXECUTE FUNCTION reject_mutation();
CREATE TRIGGER "order_events_no_truncate" BEFORE TRUNCATE ON "order_events" FOR EACH STATEMENT EXECUTE FUNCTION reject_mutation();

CREATE TABLE "order_cancellation_requests" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "order_id" uuid NOT NULL REFERENCES "orders"("id") ON DELETE RESTRICT,
  "status" "cancellation_status" NOT NULL DEFAULT 'PENDING',
  "reason" "cancellation_reason" NOT NULL,
  "note" varchar(500),
  "requested_by" uuid NOT NULL REFERENCES "users"("id") ON DELETE RESTRICT,
  "decided_by" uuid REFERENCES "users"("id") ON DELETE RESTRICT,
  "decision_note" varchar(500),
  "decided_at" timestamptz,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "order_cancellation_maker_checker" CHECK ("decided_by" IS NULL OR "decided_by" <> "requested_by")
);
CREATE UNIQUE INDEX "order_cancellation_one_pending" ON "order_cancellation_requests" ("order_id") WHERE "status" = 'PENDING';

CREATE TABLE "order_import_batches" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "vendor_id" uuid NOT NULL REFERENCES "vendors"("id") ON DELETE RESTRICT,
  "filename" varchar(200) NOT NULL,
  "orders_created" integer NOT NULL,
  "orders_failed" integer NOT NULL,
  "results" jsonb NOT NULL,
  "row_errors" jsonb NOT NULL,
  "created_by" uuid NOT NULL REFERENCES "users"("id") ON DELETE RESTRICT,
  "created_at" timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX "order_import_batches_vendor_idx" ON "order_import_batches" ("vendor_id", "created_at" DESC);

CREATE TABLE "carrier_webhook_events" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "provider" varchar(20) NOT NULL,
  "account_key" char(2) NOT NULL,
  "event_key" varchar(200) NOT NULL,
  "outcome" varchar(300),
  "received_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "carrier_webhook_events_unique" UNIQUE ("provider", "account_key", "event_key")
);

CREATE OR REPLACE FUNCTION order_status_transition_allowed(from_status order_status, to_status order_status)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT from_status = to_status OR (from_status, to_status) IN (
    ('PENDING_PACKING', 'PACKING_COMPLETED'), ('PENDING_PACKING', 'ON_HOLD'), ('PENDING_PACKING', 'CANCELLED'),
    ('PACKING_COMPLETED', 'AWAITING_SHIPPING_SELECTION'), ('PACKING_COMPLETED', 'PENDING_PACKING'), ('PACKING_COMPLETED', 'ON_HOLD'), ('PACKING_COMPLETED', 'CANCELLED'),
    ('AWAITING_SHIPPING_SELECTION', 'SHIPPING_PAID'), ('AWAITING_SHIPPING_SELECTION', 'AWAITING_WALLET_FUNDING'), ('AWAITING_SHIPPING_SELECTION', 'PENDING_PACKING'), ('AWAITING_SHIPPING_SELECTION', 'ON_HOLD'), ('AWAITING_SHIPPING_SELECTION', 'CANCELLED'),
    ('AWAITING_WALLET_FUNDING', 'SHIPPING_PAID'), ('AWAITING_WALLET_FUNDING', 'AWAITING_SHIPPING_SELECTION'), ('AWAITING_WALLET_FUNDING', 'PENDING_PACKING'), ('AWAITING_WALLET_FUNDING', 'ON_HOLD'), ('AWAITING_WALLET_FUNDING', 'CANCELLED'),
    ('SHIPPING_PAID', 'LABEL_PURCHASED'), ('SHIPPING_PAID', 'AWAITING_SHIPPING_SELECTION'), ('SHIPPING_PAID', 'CANCELLED'),
    ('LABEL_PURCHASED', 'HANDED_OFF'), ('LABEL_PURCHASED', 'IN_TRANSIT'), ('LABEL_PURCHASED', 'DELIVERED'), ('LABEL_PURCHASED', 'EXCEPTION'), ('LABEL_PURCHASED', 'CANCELLED'),
    ('HANDED_OFF', 'IN_TRANSIT'), ('HANDED_OFF', 'DELIVERED'), ('HANDED_OFF', 'EXCEPTION'), ('HANDED_OFF', 'RETURNED'),
    ('IN_TRANSIT', 'DELIVERED'), ('IN_TRANSIT', 'EXCEPTION'), ('IN_TRANSIT', 'RETURNED'),
    ('EXCEPTION', 'IN_TRANSIT'), ('EXCEPTION', 'DELIVERED'), ('EXCEPTION', 'RETURNED'),
    ('DELIVERED', 'RETURNED'),
    ('ON_HOLD', 'PENDING_PACKING'), ('ON_HOLD', 'CANCELLED')
  );
$$;

CREATE OR REPLACE FUNCTION enforce_order_status_transition()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NOT order_status_transition_allowed(OLD.status, NEW.status) THEN
    RAISE EXCEPTION 'order % cannot move from % to %', OLD.reference, OLD.status, NEW.status USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.vendor_id <> OLD.vendor_id OR NEW.warehouse_id <> OLD.warehouse_id OR NEW.destination_country_code <> OLD.destination_country_code OR NEW.currency <> OLD.currency THEN
    RAISE EXCEPTION 'order % ownership, origin, destination and currency are fixed', OLD.reference USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "orders_status_transition" BEFORE UPDATE ON "orders" FOR EACH ROW EXECUTE FUNCTION enforce_order_status_transition();
CREATE TRIGGER "orders_no_delete" BEFORE DELETE ON "orders" FOR EACH ROW EXECUTE FUNCTION reject_mutation();
