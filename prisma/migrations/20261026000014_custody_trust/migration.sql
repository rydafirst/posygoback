ALTER TYPE "movement_type" ADD VALUE 'TRANSFER_OUT';
ALTER TYPE "movement_type" ADD VALUE 'TRANSFER_IN';
ALTER TYPE "movement_type" ADD VALUE 'WRITE_OFF';
ALTER TYPE "custody_event_type" ADD VALUE 'TRANSFERRED_OUT';
ALTER TYPE "custody_event_type" ADD VALUE 'TRANSFERRED_IN';
ALTER TYPE "custody_event_type" ADD VALUE 'WRITTEN_OFF';
ALTER TYPE "ledger_entry_type" ADD VALUE 'COMPENSATION';

ALTER TABLE "stock_counts" ALTER COLUMN "requested_by" DROP NOT NULL;
ALTER TABLE "orders" ADD COLUMN "seal_number" varchar(40);

CREATE TYPE "claim_kind" AS ENUM ('SHORTAGE', 'DAMAGE', 'LOSS');
CREATE TYPE "claim_source" AS ENUM ('STOCK_COUNT', 'TRANSFER', 'ORDER', 'VENDOR_REPORT', 'STAFF');
CREATE TYPE "claim_status" AS ENUM ('OPEN', 'ASSESSED', 'SETTLED', 'REJECTED');
CREATE TYPE "claim_liability" AS ENUM ('PARTNER', 'PLATFORM', 'CARRIER', 'VENDOR');

CREATE TABLE "custody_claims" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "reference" varchar(24) NOT NULL UNIQUE,
  "country_code" char(2) NOT NULL REFERENCES "countries"("code") ON DELETE RESTRICT,
  "vendor_id" uuid NOT NULL REFERENCES "vendors"("id") ON DELETE RESTRICT,
  "warehouse_id" uuid NOT NULL REFERENCES "warehouses"("id") ON DELETE RESTRICT,
  "partner_id" uuid REFERENCES "fulfilment_partners"("id") ON DELETE RESTRICT,
  "kind" "claim_kind" NOT NULL,
  "source" "claim_source" NOT NULL,
  "lot_id" uuid REFERENCES "stock_lots"("id") ON DELETE RESTRICT,
  "order_id" uuid REFERENCES "orders"("id") ON DELETE RESTRICT,
  "stock_count_id" uuid REFERENCES "stock_counts"("id") ON DELETE RESTRICT,
  "transfer_id" uuid,
  "quantity" integer NOT NULL CHECK ("quantity" > 0 AND "quantity" <= 1000000),
  "unit_value_minor" bigint NOT NULL CHECK ("unit_value_minor" >= 0),
  "amount_minor" bigint NOT NULL CHECK ("amount_minor" >= 0),
  "currency" char(3) NOT NULL,
  "description" varchar(1000) NOT NULL,
  "evidence_file_ids" jsonb NOT NULL DEFAULT '[]',
  "status" "claim_status" NOT NULL DEFAULT 'OPEN',
  "liability" "claim_liability",
  "write_off" boolean NOT NULL DEFAULT false,
  "assessed_by" uuid REFERENCES "users"("id") ON DELETE RESTRICT,
  "assessed_at" timestamptz,
  "assessment_note" varchar(1000),
  "partner_response" varchar(1000),
  "partner_responded_at" timestamptz,
  "decided_by" uuid REFERENCES "users"("id") ON DELETE RESTRICT,
  "decided_at" timestamptz,
  "decision_note" varchar(1000),
  "compensation_minor" bigint NOT NULL DEFAULT 0 CHECK ("compensation_minor" >= 0),
  "recovered_ledger_minor" bigint NOT NULL DEFAULT 0 CHECK ("recovered_ledger_minor" >= 0),
  "recovered_deposit_minor" bigint NOT NULL DEFAULT 0 CHECK ("recovered_deposit_minor" >= 0),
  "platform_cover_minor" bigint NOT NULL DEFAULT 0 CHECK ("platform_cover_minor" >= 0),
  "created_by" uuid REFERENCES "users"("id") ON DELETE RESTRICT,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "custody_claims_decider_not_assessor" CHECK ("decided_by" IS NULL OR "assessed_by" IS NULL OR "decided_by" <> "assessed_by"),
  CONSTRAINT "custody_claims_assessed" CHECK ("status" = 'OPEN' OR "status" = 'REJECTED' OR ("liability" IS NOT NULL AND "assessed_by" IS NOT NULL)),
  CONSTRAINT "custody_claims_decided" CHECK ("status" NOT IN ('SETTLED', 'REJECTED') OR "decided_at" IS NOT NULL),
  CONSTRAINT "custody_claims_partner_liability" CHECK ("liability" <> 'PARTNER' OR "partner_id" IS NOT NULL),
  CONSTRAINT "custody_claims_split" CHECK ("status" <> 'SETTLED' OR "recovered_ledger_minor" + "recovered_deposit_minor" + "platform_cover_minor" = "compensation_minor" OR "liability" = 'VENDOR')
);
CREATE INDEX "custody_claims_status_idx" ON "custody_claims" ("status", "created_at");
CREATE INDEX "custody_claims_vendor_idx" ON "custody_claims" ("vendor_id", "created_at");
CREATE INDEX "custody_claims_partner_idx" ON "custody_claims" ("partner_id", "created_at");
CREATE UNIQUE INDEX "custody_claims_count_lot_unique" ON "custody_claims" ("stock_count_id", "lot_id") WHERE "stock_count_id" IS NOT NULL;
CREATE UNIQUE INDEX "custody_claims_transfer_lot_unique" ON "custody_claims" ("transfer_id", "lot_id") WHERE "transfer_id" IS NOT NULL;

CREATE TABLE "partner_security_draws" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "security_id" uuid NOT NULL REFERENCES "partner_securities"("id") ON DELETE RESTRICT,
  "claim_id" uuid NOT NULL REFERENCES "custody_claims"("id") ON DELETE RESTRICT,
  "amount_minor" bigint NOT NULL CHECK ("amount_minor" > 0),
  "created_by" uuid NOT NULL REFERENCES "users"("id") ON DELETE RESTRICT,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "partner_security_draws_once" UNIQUE ("security_id", "claim_id")
);
CREATE TRIGGER "partner_security_draws_no_update" BEFORE UPDATE OR DELETE ON "partner_security_draws" FOR EACH ROW EXECUTE FUNCTION reject_mutation();

CREATE TYPE "custody_alert_kind" AS ENUM ('NO_CARRIER_SCAN', 'COUNT_SHORTFALL', 'SHRINKAGE', 'TRUST_LOW');
CREATE TYPE "custody_alert_status" AS ENUM ('OPEN', 'RESOLVED');

CREATE TABLE "custody_alerts" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "kind" "custody_alert_kind" NOT NULL,
  "status" "custody_alert_status" NOT NULL DEFAULT 'OPEN',
  "country_code" char(2) NOT NULL REFERENCES "countries"("code") ON DELETE RESTRICT,
  "partner_id" uuid REFERENCES "fulfilment_partners"("id") ON DELETE RESTRICT,
  "warehouse_id" uuid REFERENCES "warehouses"("id") ON DELETE RESTRICT,
  "subject_type" varchar(40) NOT NULL,
  "subject_id" uuid NOT NULL,
  "message" varchar(500) NOT NULL,
  "resolved_by" uuid REFERENCES "users"("id") ON DELETE RESTRICT,
  "resolved_at" timestamptz,
  "resolution_note" varchar(1000),
  "created_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "custody_alerts_resolved" CHECK (("status" = 'RESOLVED') = ("resolved_at" IS NOT NULL))
);
CREATE UNIQUE INDEX "custody_alerts_one_open" ON "custody_alerts" ("kind", "subject_id") WHERE "status" = 'OPEN';
CREATE INDEX "custody_alerts_status_idx" ON "custody_alerts" ("status", "created_at");

CREATE TYPE "transfer_status" AS ENUM ('REQUESTED', 'DISPATCHED', 'RECEIVED', 'CANCELLED');

CREATE TABLE "stock_transfers" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "reference" varchar(24) NOT NULL UNIQUE,
  "country_code" char(2) NOT NULL REFERENCES "countries"("code") ON DELETE RESTRICT,
  "from_warehouse_id" uuid NOT NULL REFERENCES "warehouses"("id") ON DELETE RESTRICT,
  "to_warehouse_id" uuid NOT NULL REFERENCES "warehouses"("id") ON DELETE RESTRICT,
  "status" "transfer_status" NOT NULL DEFAULT 'REQUESTED',
  "reason" varchar(500) NOT NULL,
  "carrier" varchar(80),
  "tracking_number" varchar(80),
  "seal_number" varchar(40),
  "dispatch_file_ids" jsonb NOT NULL DEFAULT '[]',
  "requested_by" uuid NOT NULL REFERENCES "users"("id") ON DELETE RESTRICT,
  "dispatched_by" uuid REFERENCES "users"("id") ON DELETE RESTRICT,
  "dispatched_at" timestamptz,
  "received_by" uuid REFERENCES "users"("id") ON DELETE RESTRICT,
  "received_at" timestamptz,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "stock_transfers_different_warehouses" CHECK ("from_warehouse_id" <> "to_warehouse_id"),
  CONSTRAINT "stock_transfers_receiver_not_dispatcher" CHECK ("received_by" IS NULL OR "dispatched_by" IS NULL OR "received_by" <> "dispatched_by")
);
CREATE INDEX "stock_transfers_from_idx" ON "stock_transfers" ("from_warehouse_id", "status");
CREATE INDEX "stock_transfers_to_idx" ON "stock_transfers" ("to_warehouse_id", "status");
ALTER TABLE "custody_claims" ADD CONSTRAINT "custody_claims_transfer_fk" FOREIGN KEY ("transfer_id") REFERENCES "stock_transfers"("id") ON DELETE RESTRICT;

CREATE TABLE "stock_transfer_lines" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "transfer_id" uuid NOT NULL REFERENCES "stock_transfers"("id") ON DELETE RESTRICT,
  "lot_id" uuid NOT NULL REFERENCES "stock_lots"("id") ON DELETE RESTRICT,
  "quantity_sent" integer NOT NULL CHECK ("quantity_sent" > 0),
  "quantity_received" integer CHECK ("quantity_received" >= 0),
  CONSTRAINT "stock_transfer_lines_lot_unique" UNIQUE ("transfer_id", "lot_id")
);
CREATE INDEX "stock_transfer_lines_lot_idx" ON "stock_transfer_lines" ("lot_id");

ALTER TABLE "ledger_entries" DROP CONSTRAINT "ledger_entries_sign_matches_type";
ALTER TABLE "ledger_entries" ADD CONSTRAINT "ledger_entries_sign_matches_type" CHECK (
  ("type"::text IN ('DEPOSIT', 'MANUAL_CREDIT', 'REFUND', 'REVERSAL', 'COMPENSATION') AND "amount_minor" > 0)
  OR ("type"::text IN ('ONBOARDING', 'STORAGE', 'FULFILMENT', 'SHIPPING', 'RETURN', 'RECEIVING_HOLD_FEE', 'MANUAL_DEBIT', 'PAYMENT_REVERSAL') AND "amount_minor" < 0)
);
