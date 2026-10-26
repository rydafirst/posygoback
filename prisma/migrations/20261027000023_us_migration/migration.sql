ALTER TYPE "ledger_entry_type" ADD VALUE 'CARRIED_OVER';

CREATE TABLE "migration_links" (
  "source_table" varchar(40) NOT NULL,
  "source_id" varchar(120) NOT NULL,
  "target_id" uuid NOT NULL,
  "created_at" timestamptz(6) NOT NULL DEFAULT now(),
  PRIMARY KEY ("source_table", "source_id")
);
CREATE INDEX "migration_links_target_idx" ON "migration_links" ("target_id");

ALTER TABLE "ledger_entries" DROP CONSTRAINT "ledger_entries_sign_matches_type";
ALTER TABLE "ledger_entries" ADD CONSTRAINT "ledger_entries_sign_matches_type" CHECK (
  ("type"::text IN ('DEPOSIT', 'MANUAL_CREDIT', 'REFUND', 'REVERSAL', 'COMPENSATION', 'REFERRAL_CREDIT', 'CARRIED_OVER') AND "amount_minor" > 0)
  OR ("type"::text IN ('ONBOARDING', 'STORAGE', 'FULFILMENT', 'SHIPPING', 'RETURN', 'RECEIVING_HOLD_FEE', 'MANUAL_DEBIT', 'PAYMENT_REVERSAL', 'STOREFRONT_FEE') AND "amount_minor" < 0)
);
