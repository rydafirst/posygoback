ALTER TYPE "partner_status" RENAME VALUE 'APPROVED' TO 'VERIFYING';
ALTER TYPE "partner_payout_status" ADD VALUE 'PROCESSING';
ALTER TYPE "partner_payout_status" ADD VALUE 'FAILED';
ALTER TYPE "file_purpose" ADD VALUE 'PROOF_OF_ADDRESS';
ALTER TYPE "file_purpose" ADD VALUE 'STOCK_COUNT';
ALTER TYPE "file_status" ADD VALUE 'PURGED';

ALTER TABLE "fulfilment_partners" ALTER COLUMN "created_by" DROP NOT NULL;
ALTER TABLE "fulfilment_partners" ALTER COLUMN "kind" SET DEFAULT 'INDIVIDUAL';
ALTER TABLE "fulfilment_partners" ADD COLUMN "tier_level" integer NOT NULL DEFAULT 1 CHECK ("tier_level" BETWEEN 1 AND 10);
ALTER TABLE "fulfilment_partners" ADD COLUMN "founding" boolean NOT NULL DEFAULT false;
ALTER TABLE "fulfilment_partners" ADD COLUMN "approved_by" uuid REFERENCES "users"("id") ON DELETE RESTRICT;
UPDATE "fulfilment_partners" SET "status" = 'VERIFYING', "status_reason" = 'Moved to the new verification steps' WHERE "status" = 'UNDER_REVIEW';

DELETE FROM "partner_checks";
ALTER TABLE "partner_checks" ALTER COLUMN "kind" TYPE text;
DROP TYPE "partner_check_kind";
CREATE TYPE "partner_check_kind" AS ENUM ('REFERRAL', 'IDENTITY', 'PROOF_OF_ADDRESS', 'STORAGE_SPACE', 'WORK_STATUS');
ALTER TABLE "partner_checks" ALTER COLUMN "kind" TYPE "partner_check_kind" USING "kind"::"partner_check_kind";
ALTER TABLE "partner_checks" ADD COLUMN "details" jsonb NOT NULL DEFAULT '{}';
ALTER TABLE "partner_checks" ADD COLUMN "files_purged_at" timestamptz;
ALTER TABLE "partner_checks" ADD COLUMN "call_scheduled_at" timestamptz;
ALTER TABLE "partner_checks" ADD COLUMN "call_outcome" varchar(1000);
ALTER TABLE "partner_checks" ADD COLUMN "call_recorded_by" uuid REFERENCES "users"("id") ON DELETE RESTRICT;

ALTER TABLE "partner_agreement_acceptances" ADD COLUMN "signature_name" varchar(160);
ALTER TABLE "partner_agreement_acceptances" ADD COLUMN "document_sha256" char(64);
ALTER TABLE "partner_agreement_acceptances" ADD COLUMN "user_agent" varchar(512);

DROP TABLE "partner_payout_accounts";
DROP TYPE "payout_account_status";
CREATE TYPE "payout_account_status" AS ENUM ('ONBOARDING', 'ACTIVE', 'RESTRICTED');
CREATE TABLE "partner_payout_accounts" (
  "partner_id" uuid PRIMARY KEY REFERENCES "fulfilment_partners"("id") ON DELETE RESTRICT,
  "provider" varchar(30) NOT NULL,
  "provider_account_id" varchar(120) NOT NULL,
  "status" "payout_account_status" NOT NULL DEFAULT 'ONBOARDING',
  "bank_summary" varchar(120),
  "bank_fingerprint" varchar(120),
  "details_changed_at" timestamptz,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "partner_payout_accounts_provider_unique" UNIQUE ("provider", "provider_account_id")
);

ALTER TABLE "partner_payouts" ADD COLUMN "provider_transfer_id" varchar(120);
ALTER TABLE "partner_payouts" ADD COLUMN "failure_reason" varchar(300);
DROP INDEX "partner_payouts_one_pending";

CREATE OR REPLACE FUNCTION enforce_partner_status_transition()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.status <> OLD.status AND NOT (OLD.status, NEW.status) IN (
    ('APPLIED', 'VERIFYING'), ('APPLIED', 'REJECTED'),
    ('VERIFYING', 'UNDER_REVIEW'), ('VERIFYING', 'REJECTED'),
    ('UNDER_REVIEW', 'VERIFYING'), ('UNDER_REVIEW', 'ACTIVE'), ('UNDER_REVIEW', 'REJECTED'),
    ('ACTIVE', 'SUSPENDED'), ('ACTIVE', 'OFFBOARDING'),
    ('SUSPENDED', 'ACTIVE'), ('SUSPENDED', 'OFFBOARDING'),
    ('OFFBOARDING', 'TERMINATED')
  ) THEN
    RAISE EXCEPTION 'partner % cannot move from % to %', OLD.reference, OLD.status, NEW.status USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.country_code <> OLD.country_code THEN
    RAISE EXCEPTION 'partner % country is fixed', OLD.reference USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TABLE "order_dispatch_photos" (
  "order_id" uuid NOT NULL REFERENCES "orders"("id") ON DELETE RESTRICT,
  "file_id" uuid NOT NULL REFERENCES "stored_files"("id") ON DELETE RESTRICT,
  "added_by" uuid NOT NULL REFERENCES "users"("id") ON DELETE RESTRICT,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY ("order_id", "file_id"),
  CONSTRAINT "order_dispatch_photos_file_unique" UNIQUE ("file_id")
);
CREATE TRIGGER "order_dispatch_photos_append_only" BEFORE UPDATE OR DELETE ON "order_dispatch_photos" FOR EACH ROW EXECUTE FUNCTION reject_mutation();

CREATE TYPE "stock_count_status" AS ENUM ('REQUESTED', 'MATCHED', 'FLAGGED', 'MISSED');
CREATE TABLE "stock_counts" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "partner_id" uuid NOT NULL REFERENCES "fulfilment_partners"("id") ON DELETE RESTRICT,
  "warehouse_id" uuid NOT NULL REFERENCES "warehouses"("id") ON DELETE RESTRICT,
  "status" "stock_count_status" NOT NULL DEFAULT 'REQUESTED',
  "requested_by" uuid NOT NULL REFERENCES "users"("id") ON DELETE RESTRICT,
  "note" varchar(500),
  "due_at" timestamptz NOT NULL,
  "video_file_id" uuid REFERENCES "stored_files"("id") ON DELETE RESTRICT,
  "submitted_by" uuid REFERENCES "users"("id") ON DELETE RESTRICT,
  "submitted_at" timestamptz,
  "mismatched_lines" integer NOT NULL DEFAULT 0,
  "resolved_by" uuid REFERENCES "users"("id") ON DELETE RESTRICT,
  "resolved_at" timestamptz,
  "resolution_note" varchar(1000),
  "created_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "stock_counts_submitted_together" CHECK (("submitted_at" IS NULL) = ("submitted_by" IS NULL)),
  CONSTRAINT "stock_counts_resolver_not_counter" CHECK ("resolved_by" IS NULL OR "submitted_by" IS NULL OR "resolved_by" <> "submitted_by")
);
CREATE UNIQUE INDEX "stock_counts_one_open" ON "stock_counts" ("warehouse_id") WHERE "status" = 'REQUESTED';
CREATE INDEX "stock_counts_partner_idx" ON "stock_counts" ("partner_id", "created_at");

CREATE TABLE "stock_count_lines" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "count_id" uuid NOT NULL REFERENCES "stock_counts"("id") ON DELETE RESTRICT,
  "lot_id" uuid NOT NULL REFERENCES "stock_lots"("id") ON DELETE RESTRICT,
  "expected_quantity" integer CHECK ("expected_quantity" >= 0),
  "counted_quantity" integer CHECK ("counted_quantity" >= 0),
  CONSTRAINT "stock_count_lines_lot_unique" UNIQUE ("count_id", "lot_id")
);

CREATE TYPE "mystery_outcome" AS ENUM ('PENDING', 'PASSED', 'FAILED');
CREATE TABLE "mystery_orders" (
  "order_id" uuid PRIMARY KEY REFERENCES "orders"("id") ON DELETE RESTRICT,
  "partner_id" uuid NOT NULL REFERENCES "fulfilment_partners"("id") ON DELETE RESTRICT,
  "created_by" uuid NOT NULL REFERENCES "users"("id") ON DELETE RESTRICT,
  "outcome" "mystery_outcome" NOT NULL DEFAULT 'PENDING',
  "outcome_note" varchar(1000),
  "assessed_by" uuid REFERENCES "users"("id") ON DELETE RESTRICT,
  "assessed_at" timestamptz,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "mystery_orders_assessed_together" CHECK (("outcome" = 'PENDING') = ("assessed_at" IS NULL))
);
CREATE INDEX "mystery_orders_partner_idx" ON "mystery_orders" ("partner_id", "created_at");
ALTER TABLE "staff_invitations" ALTER COLUMN "invited_by" DROP NOT NULL;
