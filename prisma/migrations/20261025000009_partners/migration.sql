CREATE TYPE "partner_status" AS ENUM ('APPLIED', 'UNDER_REVIEW', 'APPROVED', 'ACTIVE', 'SUSPENDED', 'OFFBOARDING', 'TERMINATED', 'REJECTED');
CREATE TYPE "partner_kind" AS ENUM ('INDIVIDUAL', 'COMPANY');
CREATE TYPE "partner_check_kind" AS ENUM ('PRINCIPAL_IDENTITY', 'BUSINESS_REGISTRATION', 'FACILITY', 'SECURITY', 'FINANCIAL_STANDING', 'REFERENCES', 'DRY_RUN');
CREATE TYPE "partner_check_status" AS ENUM ('NOT_STARTED', 'SUBMITTED', 'ACCEPTED', 'REJECTED');
CREATE TYPE "insurance_status" AS ENUM ('PENDING', 'VERIFIED', 'REJECTED', 'EXPIRED');
CREATE TYPE "security_kind" AS ENUM ('DEPOSIT', 'BOND');
CREATE TYPE "payout_account_status" AS ENUM ('PENDING', 'VERIFIED');
CREATE TYPE "partner_entry_type" AS ENUM ('RECEIVING', 'FULFILMENT', 'STORAGE_SHARE', 'HOLDBACK', 'HOLDBACK_RELEASE', 'PAYOUT', 'ADJUSTMENT');
CREATE TYPE "partner_bucket" AS ENUM ('AVAILABLE', 'HELD');
CREATE TYPE "partner_payout_status" AS ENUM ('PENDING_APPROVAL', 'PAID', 'REJECTED');

ALTER TYPE "legal_document_kind" ADD VALUE 'PARTNER_AGREEMENT';
ALTER TYPE "legal_document_kind" ADD VALUE 'CUSTODY_TERMS';
ALTER TYPE "legal_document_kind" ADD VALUE 'NON_DIVERSION';
ALTER TYPE "legal_document_kind" ADD VALUE 'DATA_PROCESSING';
ALTER TYPE "legal_document_kind" ADD VALUE 'INSURANCE_OBLIGATION';
ALTER TYPE "file_purpose" ADD VALUE 'PARTNER_EVIDENCE';

CREATE TABLE "fulfilment_partners" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "reference" varchar(20) NOT NULL,
  "country_code" char(2) NOT NULL REFERENCES "countries"("code") ON DELETE RESTRICT,
  "kind" "partner_kind" NOT NULL,
  "legal_name" varchar(160) NOT NULL,
  "contact_email" varchar(254) NOT NULL,
  "status" "partner_status" NOT NULL DEFAULT 'APPLIED',
  "status_reason" varchar(1000),
  "profile" jsonb,
  "required_deposit_minor" bigint NOT NULL CHECK ("required_deposit_minor" >= 0),
  "required_insurance_minor" bigint NOT NULL CHECK ("required_insurance_minor" >= 0),
  "created_by" uuid NOT NULL REFERENCES "users"("id") ON DELETE RESTRICT,
  "activated_at" timestamptz,
  "terminated_at" timestamptz,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "fulfilment_partners_reference_unique" UNIQUE ("reference")
);
CREATE INDEX "fulfilment_partners_country_idx" ON "fulfilment_partners" ("country_code", "status");

ALTER TABLE "users" ADD COLUMN "partner_id" uuid REFERENCES "fulfilment_partners"("id") ON DELETE RESTRICT;
ALTER TABLE "users" ADD CONSTRAINT "users_partner_roles_have_partner" CHECK (("role" IN ('FULFILMENT_PARTNER', 'PARTNER_STAFF')) = ("partner_id" IS NOT NULL));
CREATE INDEX "users_partner_idx" ON "users" ("partner_id");
ALTER TABLE "staff_invitations" ADD COLUMN "partner_id" uuid REFERENCES "fulfilment_partners"("id") ON DELETE RESTRICT;
ALTER TABLE "staff_invitations" ADD CONSTRAINT "staff_invitations_partner_roles_have_partner" CHECK (("role" IN ('FULFILMENT_PARTNER', 'PARTNER_STAFF')) = ("partner_id" IS NOT NULL));
ALTER TABLE "warehouses" ADD COLUMN "partner_id" uuid REFERENCES "fulfilment_partners"("id") ON DELETE RESTRICT;
CREATE INDEX "warehouses_partner_idx" ON "warehouses" ("partner_id");

CREATE TABLE "partner_checks" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "partner_id" uuid NOT NULL REFERENCES "fulfilment_partners"("id") ON DELETE RESTRICT,
  "kind" "partner_check_kind" NOT NULL,
  "status" "partner_check_status" NOT NULL DEFAULT 'NOT_STARTED',
  "statement" varchar(4000),
  "file_ids" jsonb NOT NULL DEFAULT '[]',
  "submitted_by" uuid REFERENCES "users"("id") ON DELETE RESTRICT,
  "submitted_at" timestamptz,
  "reviewed_by" uuid REFERENCES "users"("id") ON DELETE RESTRICT,
  "reviewed_at" timestamptz,
  "review_note" varchar(1000),
  CONSTRAINT "partner_checks_kind_unique" UNIQUE ("partner_id", "kind"),
  CONSTRAINT "partner_checks_reviewer_not_submitter" CHECK ("reviewed_by" IS NULL OR "submitted_by" IS NULL OR "reviewed_by" <> "submitted_by")
);

CREATE TABLE "partner_agreement_acceptances" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "partner_id" uuid NOT NULL REFERENCES "fulfilment_partners"("id") ON DELETE RESTRICT,
  "legal_document_id" uuid NOT NULL REFERENCES "legal_documents"("id") ON DELETE RESTRICT,
  "accepted_by" uuid NOT NULL REFERENCES "users"("id") ON DELETE RESTRICT,
  "ip" varchar(64) NOT NULL,
  "accepted_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "partner_agreement_acceptances_unique" UNIQUE ("partner_id", "legal_document_id")
);
CREATE TRIGGER "partner_agreement_acceptances_immutable" BEFORE UPDATE OR DELETE ON "partner_agreement_acceptances" FOR EACH ROW EXECUTE FUNCTION reject_mutation();

CREATE TABLE "partner_insurance_policies" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "partner_id" uuid NOT NULL REFERENCES "fulfilment_partners"("id") ON DELETE RESTRICT,
  "insurer" varchar(120) NOT NULL,
  "policy_number" varchar(60) NOT NULL,
  "cover_minor" bigint NOT NULL CHECK ("cover_minor" > 0),
  "currency" char(3) NOT NULL,
  "starts_on" date NOT NULL,
  "expires_on" date NOT NULL,
  "file_id" uuid NOT NULL REFERENCES "stored_files"("id") ON DELETE RESTRICT,
  "status" "insurance_status" NOT NULL DEFAULT 'PENDING',
  "review_note" varchar(1000),
  "uploaded_by" uuid NOT NULL REFERENCES "users"("id") ON DELETE RESTRICT,
  "reviewed_by" uuid REFERENCES "users"("id") ON DELETE RESTRICT,
  "reviewed_at" timestamptz,
  "reminded_30_at" timestamptz,
  "reminded_7_at" timestamptz,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "partner_insurance_dates" CHECK ("expires_on" > "starts_on"),
  CONSTRAINT "partner_insurance_reviewer" CHECK ("reviewed_by" IS NULL OR "reviewed_by" <> "uploaded_by")
);
CREATE INDEX "partner_insurance_partner_idx" ON "partner_insurance_policies" ("partner_id", "status", "expires_on");

CREATE TABLE "partner_securities" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "partner_id" uuid NOT NULL REFERENCES "fulfilment_partners"("id") ON DELETE RESTRICT,
  "kind" "security_kind" NOT NULL,
  "amount_minor" bigint NOT NULL CHECK ("amount_minor" > 0),
  "currency" char(3) NOT NULL,
  "reference" varchar(120) NOT NULL,
  "expires_on" date,
  "recorded_by" uuid NOT NULL REFERENCES "users"("id") ON DELETE RESTRICT,
  "received_at" timestamptz NOT NULL DEFAULT now(),
  "released_by" uuid REFERENCES "users"("id") ON DELETE RESTRICT,
  "released_at" timestamptz,
  "release_note" varchar(500),
  CONSTRAINT "partner_securities_release_checked" CHECK ("released_by" IS NULL OR "released_by" <> "recorded_by")
);
CREATE INDEX "partner_securities_partner_idx" ON "partner_securities" ("partner_id");

CREATE TABLE "partner_payout_accounts" (
  "partner_id" uuid PRIMARY KEY REFERENCES "fulfilment_partners"("id") ON DELETE RESTRICT,
  "scheme" varchar(20) NOT NULL,
  "details_encrypted" text NOT NULL,
  "masked" varchar(200) NOT NULL,
  "status" "payout_account_status" NOT NULL DEFAULT 'PENDING',
  "updated_by" uuid NOT NULL REFERENCES "users"("id") ON DELETE RESTRICT,
  "verified_by" uuid REFERENCES "users"("id") ON DELETE RESTRICT,
  "verified_at" timestamptz,
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "partner_payout_accounts_verifier" CHECK ("verified_by" IS NULL OR "verified_by" <> "updated_by")
);

CREATE TABLE "partner_ledger_entries" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "partner_id" uuid NOT NULL REFERENCES "fulfilment_partners"("id") ON DELETE RESTRICT,
  "currency" char(3) NOT NULL,
  "type" "partner_entry_type" NOT NULL,
  "bucket" "partner_bucket" NOT NULL,
  "amount_minor" bigint NOT NULL CHECK ("amount_minor" <> 0),
  "description" varchar(300) NOT NULL,
  "idempotency_key" varchar(160) NOT NULL,
  "reference_type" varchar(40),
  "reference_id" varchar(120),
  "release_on" date,
  "created_by" uuid REFERENCES "users"("id") ON DELETE RESTRICT,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "partner_ledger_entries_key_unique" UNIQUE ("partner_id", "idempotency_key"),
  CONSTRAINT "partner_ledger_entries_held_release" CHECK (("bucket" = 'HELD' AND "amount_minor" > 0) = ("release_on" IS NOT NULL))
);
CREATE INDEX "partner_ledger_entries_partner_idx" ON "partner_ledger_entries" ("partner_id", "created_at");
CREATE INDEX "partner_ledger_entries_release_idx" ON "partner_ledger_entries" ("release_on") WHERE "release_on" IS NOT NULL;
CREATE TRIGGER "partner_ledger_entries_no_update" BEFORE UPDATE OR DELETE ON "partner_ledger_entries" FOR EACH ROW EXECUTE FUNCTION reject_mutation();
CREATE TRIGGER "partner_ledger_entries_no_truncate" BEFORE TRUNCATE ON "partner_ledger_entries" FOR EACH STATEMENT EXECUTE FUNCTION reject_mutation();

CREATE OR REPLACE FUNCTION partner_ledger_never_negative()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  remaining bigint;
BEGIN
  PERFORM 1 FROM fulfilment_partners WHERE id = NEW.partner_id FOR UPDATE;
  SELECT coalesce(sum(amount_minor), 0) + NEW.amount_minor INTO remaining FROM partner_ledger_entries WHERE partner_id = NEW.partner_id AND bucket = NEW.bucket;
  IF remaining < 0 THEN
    RAISE EXCEPTION 'partner % % balance cannot go below zero', NEW.partner_id, NEW.bucket USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER "partner_ledger_entries_balance" BEFORE INSERT ON "partner_ledger_entries" FOR EACH ROW EXECUTE FUNCTION partner_ledger_never_negative();

CREATE TABLE "partner_payouts" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "partner_id" uuid NOT NULL REFERENCES "fulfilment_partners"("id") ON DELETE RESTRICT,
  "amount_minor" bigint NOT NULL CHECK ("amount_minor" > 0),
  "currency" char(3) NOT NULL,
  "status" "partner_payout_status" NOT NULL DEFAULT 'PENDING_APPROVAL',
  "note" varchar(300) NOT NULL,
  "requested_by" uuid NOT NULL REFERENCES "users"("id") ON DELETE RESTRICT,
  "decided_by" uuid REFERENCES "users"("id") ON DELETE RESTRICT,
  "decision_note" varchar(300),
  "decided_at" timestamptz,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "partner_payouts_maker_checker" CHECK ("decided_by" IS NULL OR "decided_by" <> "requested_by")
);
CREATE UNIQUE INDEX "partner_payouts_one_pending" ON "partner_payouts" ("partner_id") WHERE "status" = 'PENDING_APPROVAL';

CREATE OR REPLACE FUNCTION enforce_partner_status_transition()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.status <> OLD.status AND NOT (OLD.status, NEW.status) IN (
    ('APPLIED', 'UNDER_REVIEW'), ('APPLIED', 'REJECTED'),
    ('UNDER_REVIEW', 'APPROVED'), ('UNDER_REVIEW', 'APPLIED'), ('UNDER_REVIEW', 'REJECTED'),
    ('APPROVED', 'ACTIVE'), ('APPROVED', 'REJECTED'),
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
CREATE TRIGGER "fulfilment_partners_status_transition" BEFORE UPDATE ON "fulfilment_partners" FOR EACH ROW EXECUTE FUNCTION enforce_partner_status_transition();
CREATE TRIGGER "fulfilment_partners_no_delete" BEFORE DELETE ON "fulfilment_partners" FOR EACH ROW EXECUTE FUNCTION reject_mutation();

CREATE OR REPLACE FUNCTION warehouse_partner_same_country()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.partner_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM fulfilment_partners WHERE id = NEW.partner_id AND country_code = NEW.country_code) THEN
    RAISE EXCEPTION 'warehouse % and its partner must be in the same country', NEW.code USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER "warehouses_partner_country" BEFORE INSERT OR UPDATE OF "partner_id", "country_code" ON "warehouses" FOR EACH ROW EXECUTE FUNCTION warehouse_partner_same_country();

CREATE OR REPLACE FUNCTION partner_user_same_country()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.partner_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM fulfilment_partners WHERE id = NEW.partner_id AND country_code = NEW.country_code) THEN
    RAISE EXCEPTION 'partner users must belong to the partner''s country' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER "users_partner_country" BEFORE INSERT OR UPDATE OF "partner_id", "country_code" ON "users" FOR EACH ROW EXECUTE FUNCTION partner_user_same_country();
