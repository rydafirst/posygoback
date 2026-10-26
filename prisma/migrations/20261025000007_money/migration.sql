CREATE TYPE "fee_schedule_status" AS ENUM ('PROPOSED', 'ACTIVE', 'REJECTED', 'SUPERSEDED');
CREATE TYPE "wallet_status" AS ENUM ('ACTIVE', 'STORAGE_OVERDUE', 'FROZEN', 'CLOSED');
CREATE TYPE "ledger_entry_type" AS ENUM ('DEPOSIT', 'ONBOARDING', 'STORAGE', 'FULFILMENT', 'SHIPPING', 'RETURN', 'RECEIVING_HOLD_FEE', 'MANUAL_CREDIT', 'MANUAL_DEBIT', 'REFUND', 'REVERSAL', 'PAYMENT_REVERSAL');
CREATE TYPE "top_up_status" AS ENUM ('PENDING', 'SUCCEEDED', 'FAILED', 'EXPIRED', 'REFUNDED');
CREATE TYPE "adjustment_direction" AS ENUM ('CREDIT', 'DEBIT');
CREATE TYPE "adjustment_status" AS ENUM ('PENDING_APPROVAL', 'APPLIED', 'REJECTED');

CREATE TABLE "fee_schedules" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "country_code" char(2) NOT NULL,
  "version" integer NOT NULL,
  "status" "fee_schedule_status" DEFAULT 'PROPOSED' NOT NULL,
  "schedule" jsonb NOT NULL,
  "note" varchar(500) NOT NULL,
  "proposed_by" uuid,
  "proposed_at" timestamp with time zone DEFAULT now() NOT NULL,
  "decided_by" uuid,
  "decided_at" timestamp with time zone,
  "decision_note" varchar(500),
  CONSTRAINT "fee_schedules_maker_checker" CHECK ("decided_by" IS NULL OR "decided_by" <> "proposed_by")
);
CREATE UNIQUE INDEX "fee_schedules_version_unique" ON "fee_schedules" ("country_code", "version");
CREATE INDEX "fee_schedules_country_status_idx" ON "fee_schedules" ("country_code", "status");
CREATE UNIQUE INDEX "fee_schedules_one_active" ON "fee_schedules" ("country_code") WHERE "status" = 'ACTIVE';
CREATE UNIQUE INDEX "fee_schedules_one_proposed" ON "fee_schedules" ("country_code") WHERE "status" = 'PROPOSED';
ALTER TABLE "fee_schedules" ADD CONSTRAINT "fee_schedules_country_code_countries_code_fk" FOREIGN KEY ("country_code") REFERENCES "countries"("code") ON DELETE RESTRICT ON UPDATE NO ACTION;
ALTER TABLE "fee_schedules" ADD CONSTRAINT "fee_schedules_proposed_by_users_id_fk" FOREIGN KEY ("proposed_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;
ALTER TABLE "fee_schedules" ADD CONSTRAINT "fee_schedules_decided_by_users_id_fk" FOREIGN KEY ("decided_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;

CREATE TABLE "wallets" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "vendor_id" uuid NOT NULL,
  "currency" char(3) NOT NULL,
  "balance_minor" bigint DEFAULT 0 NOT NULL,
  "low_balance_threshold_minor" bigint DEFAULT 5000 NOT NULL,
  "status" "wallet_status" DEFAULT 'ACTIVE' NOT NULL,
  "overdue_since" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "wallets_balance_non_negative" CHECK ("balance_minor" >= 0),
  CONSTRAINT "wallets_threshold_non_negative" CHECK ("low_balance_threshold_minor" >= 0)
);
CREATE UNIQUE INDEX "wallets_vendor_currency_unique" ON "wallets" ("vendor_id", "currency");
ALTER TABLE "wallets" ADD CONSTRAINT "wallets_vendor_id_vendors_id_fk" FOREIGN KEY ("vendor_id") REFERENCES "vendors"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;

CREATE TABLE "ledger_entries" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "wallet_id" uuid NOT NULL,
  "vendor_id" uuid NOT NULL,
  "type" "ledger_entry_type" NOT NULL,
  "amount_minor" bigint NOT NULL,
  "balance_after_minor" bigint NOT NULL,
  "description" varchar(300) NOT NULL,
  "reference_type" varchar(40),
  "reference_id" varchar(120),
  "idempotency_key" varchar(160) NOT NULL,
  "created_by" uuid,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "ledger_entries_balance_non_negative" CHECK ("balance_after_minor" >= 0),
  CONSTRAINT "ledger_entries_sign_matches_type" CHECK (
    ("type" IN ('DEPOSIT', 'MANUAL_CREDIT', 'REFUND', 'REVERSAL') AND "amount_minor" > 0)
    OR ("type" IN ('ONBOARDING', 'STORAGE', 'FULFILMENT', 'SHIPPING', 'RETURN', 'RECEIVING_HOLD_FEE', 'MANUAL_DEBIT', 'PAYMENT_REVERSAL') AND "amount_minor" < 0)
  )
);
CREATE UNIQUE INDEX "ledger_entries_idempotency_unique" ON "ledger_entries" ("wallet_id", "idempotency_key");
CREATE INDEX "ledger_entries_wallet_created_idx" ON "ledger_entries" ("wallet_id", "created_at");
CREATE INDEX "ledger_entries_reference_idx" ON "ledger_entries" ("reference_type", "reference_id");
ALTER TABLE "ledger_entries" ADD CONSTRAINT "ledger_entries_wallet_id_wallets_id_fk" FOREIGN KEY ("wallet_id") REFERENCES "wallets"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;
ALTER TABLE "ledger_entries" ADD CONSTRAINT "ledger_entries_vendor_id_vendors_id_fk" FOREIGN KEY ("vendor_id") REFERENCES "vendors"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;
ALTER TABLE "ledger_entries" ADD CONSTRAINT "ledger_entries_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;
CREATE TRIGGER "ledger_entries_no_update" BEFORE UPDATE OR DELETE ON "ledger_entries" FOR EACH ROW EXECUTE FUNCTION reject_mutation();
CREATE TRIGGER "ledger_entries_no_truncate" BEFORE TRUNCATE ON "ledger_entries" FOR EACH STATEMENT EXECUTE FUNCTION reject_mutation();

CREATE OR REPLACE FUNCTION ledger_entry_matches_wallet()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  current_balance bigint;
  wallet_vendor uuid;
BEGIN
  SELECT balance_minor, vendor_id INTO current_balance, wallet_vendor FROM wallets WHERE id = NEW.wallet_id FOR UPDATE;
  IF wallet_vendor IS DISTINCT FROM NEW.vendor_id THEN
    RAISE EXCEPTION 'ledger entry vendor does not own the wallet' USING ERRCODE = 'check_violation';
  END IF;
  IF current_balance + NEW.amount_minor <> NEW.balance_after_minor THEN
    RAISE EXCEPTION 'ledger entry balance does not follow the wallet balance' USING ERRCODE = 'check_violation';
  END IF;
  PERFORM set_config('gfn.ledger_write', 'on', true);
  UPDATE wallets SET balance_minor = NEW.balance_after_minor, updated_at = now() WHERE id = NEW.wallet_id;
  PERFORM set_config('gfn.ledger_write', 'off', true);
  RETURN NEW;
END;
$$;
CREATE OR REPLACE FUNCTION wallet_balance_only_from_ledger()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.balance_minor IS DISTINCT FROM OLD.balance_minor AND current_setting('gfn.ledger_write', true) IS DISTINCT FROM 'on' THEN
    RAISE EXCEPTION 'wallet balances change only through ledger entries' USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER "wallets_balance_guard" BEFORE UPDATE ON "wallets" FOR EACH ROW EXECUTE FUNCTION wallet_balance_only_from_ledger();
CREATE TRIGGER "wallets_no_delete" BEFORE DELETE ON "wallets" FOR EACH ROW EXECUTE FUNCTION reject_mutation();
CREATE TRIGGER "ledger_entries_apply_to_wallet" BEFORE INSERT ON "ledger_entries" FOR EACH ROW EXECUTE FUNCTION ledger_entry_matches_wallet();

CREATE TABLE "top_ups" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "wallet_id" uuid NOT NULL,
  "vendor_id" uuid NOT NULL,
  "country_code" char(2) NOT NULL,
  "processor" varchar(20) NOT NULL,
  "provider_reference" varchar(255),
  "provider_payment_id" varchar(255),
  "currency" char(3) NOT NULL,
  "net_minor" bigint NOT NULL,
  "gross_minor" bigint NOT NULL,
  "fee_minor" bigint NOT NULL,
  "refunded_minor" bigint DEFAULT 0 NOT NULL,
  "status" "top_up_status" DEFAULT 'PENDING' NOT NULL,
  "created_by" uuid NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "completed_at" timestamp with time zone,
  CONSTRAINT "top_ups_amounts_valid" CHECK ("net_minor" > 0 AND "gross_minor" >= "net_minor" AND "fee_minor" = "gross_minor" - "net_minor" AND "refunded_minor" >= 0 AND "refunded_minor" <= "gross_minor")
);
CREATE UNIQUE INDEX "top_ups_provider_reference_unique" ON "top_ups" ("provider_reference");
CREATE UNIQUE INDEX "top_ups_provider_payment_unique" ON "top_ups" ("provider_payment_id");
CREATE INDEX "top_ups_vendor_created_idx" ON "top_ups" ("vendor_id", "created_at");
ALTER TABLE "top_ups" ADD CONSTRAINT "top_ups_wallet_id_wallets_id_fk" FOREIGN KEY ("wallet_id") REFERENCES "wallets"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;
ALTER TABLE "top_ups" ADD CONSTRAINT "top_ups_vendor_id_vendors_id_fk" FOREIGN KEY ("vendor_id") REFERENCES "vendors"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;
ALTER TABLE "top_ups" ADD CONSTRAINT "top_ups_country_code_countries_code_fk" FOREIGN KEY ("country_code") REFERENCES "countries"("code") ON DELETE RESTRICT ON UPDATE NO ACTION;
ALTER TABLE "top_ups" ADD CONSTRAINT "top_ups_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;

CREATE TABLE "payment_events" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "provider" varchar(20) NOT NULL,
  "account_key" varchar(10) NOT NULL,
  "event_id" varchar(255) NOT NULL,
  "type" varchar(80) NOT NULL,
  "payload" jsonb NOT NULL,
  "received_at" timestamp with time zone DEFAULT now() NOT NULL,
  "processed_at" timestamp with time zone,
  "outcome" varchar(300)
);
CREATE UNIQUE INDEX "payment_events_event_unique" ON "payment_events" ("provider", "account_key", "event_id");

CREATE TABLE "wallet_adjustments" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "wallet_id" uuid NOT NULL,
  "direction" "adjustment_direction" NOT NULL,
  "amount_minor" bigint NOT NULL,
  "reason" varchar(300) NOT NULL,
  "reference" varchar(120),
  "status" "adjustment_status" DEFAULT 'PENDING_APPROVAL' NOT NULL,
  "requested_by" uuid NOT NULL,
  "decided_by" uuid,
  "decision_note" varchar(300),
  "ledger_entry_id" uuid,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "decided_at" timestamp with time zone,
  CONSTRAINT "wallet_adjustments_amount_positive" CHECK ("amount_minor" > 0),
  CONSTRAINT "wallet_adjustments_maker_checker" CHECK ("decided_by" IS NULL OR "decided_by" <> "requested_by")
);
CREATE UNIQUE INDEX "wallet_adjustments_ledger_entry_unique" ON "wallet_adjustments" ("ledger_entry_id");
CREATE INDEX "wallet_adjustments_status_idx" ON "wallet_adjustments" ("status", "created_at");
ALTER TABLE "wallet_adjustments" ADD CONSTRAINT "wallet_adjustments_wallet_id_wallets_id_fk" FOREIGN KEY ("wallet_id") REFERENCES "wallets"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;
ALTER TABLE "wallet_adjustments" ADD CONSTRAINT "wallet_adjustments_requested_by_users_id_fk" FOREIGN KEY ("requested_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;
ALTER TABLE "wallet_adjustments" ADD CONSTRAINT "wallet_adjustments_decided_by_users_id_fk" FOREIGN KEY ("decided_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;
ALTER TABLE "wallet_adjustments" ADD CONSTRAINT "wallet_adjustments_ledger_entry_id_ledger_entries_id_fk" FOREIGN KEY ("ledger_entry_id") REFERENCES "ledger_entries"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;

CREATE TABLE "reconciliation_reports" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "ran_at" timestamp with time zone DEFAULT now() NOT NULL,
  "wallets_checked" integer NOT NULL,
  "mismatches" jsonb NOT NULL
);
CREATE INDEX "reconciliation_reports_ran_idx" ON "reconciliation_reports" ("ran_at");

ALTER TABLE "inbound_shipments" ADD COLUMN "onboarding_fee_minor" bigint;
ALTER TABLE "inbound_shipments" ADD COLUMN "onboarding_charged_at" timestamp with time zone;
ALTER TABLE "inbound_shipments" ADD COLUMN "fee_schedule_id" uuid;
ALTER TABLE "inbound_shipments" ADD COLUMN "hold_charge_minor" bigint;
ALTER TABLE "inbound_shipments" ADD COLUMN "hold_placed_at" timestamp with time zone;
ALTER TABLE "inbound_shipments" ADD COLUMN "hold_paid_at" timestamp with time zone;
ALTER TABLE "inbound_shipments" ADD COLUMN "status_before_hold" "inbound_status";
ALTER TABLE "inbound_shipments" ADD CONSTRAINT "inbound_shipments_fee_schedule_id_fee_schedules_id_fk" FOREIGN KEY ("fee_schedule_id") REFERENCES "fee_schedules"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;
ALTER TABLE "inbound_shipments" ADD CONSTRAINT "inbound_shipments_charges_non_negative" CHECK (coalesce("onboarding_fee_minor", 0) >= 0 AND coalesce("hold_charge_minor", 0) >= 0);

ALTER TABLE "storage_boxes" ADD COLUMN "next_billing_date" date;
CREATE INDEX "storage_boxes_billing_idx" ON "storage_boxes" ("next_billing_date");
