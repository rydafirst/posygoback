ALTER TYPE "ledger_entry_type" ADD VALUE 'REFERRAL_CREDIT';

ALTER TABLE "ledger_entries" DROP CONSTRAINT "ledger_entries_sign_matches_type";
ALTER TABLE "ledger_entries" ADD CONSTRAINT "ledger_entries_sign_matches_type" CHECK (
  ("type"::text IN ('DEPOSIT', 'MANUAL_CREDIT', 'REFUND', 'REVERSAL', 'COMPENSATION', 'REFERRAL_CREDIT') AND "amount_minor" > 0)
  OR ("type"::text IN ('ONBOARDING', 'STORAGE', 'FULFILMENT', 'SHIPPING', 'RETURN', 'RECEIVING_HOLD_FEE', 'MANUAL_DEBIT', 'PAYMENT_REVERSAL', 'STOREFRONT_FEE') AND "amount_minor" < 0)
);

CREATE TABLE "referral_campaigns" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "country_code" char(2) NOT NULL REFERENCES "countries"("code") ON DELETE RESTRICT,
  "name" varchar(80) NOT NULL,
  "referee_credit_minor" bigint NOT NULL CHECK ("referee_credit_minor" >= 0),
  "starts_at" timestamptz(6),
  "ends_at" timestamptz(6),
  "max_signups" integer CHECK ("max_signups" > 0),
  "signups" integer NOT NULL DEFAULT 0 CHECK ("signups" >= 0),
  "active" boolean NOT NULL DEFAULT true,
  "created_by" uuid NOT NULL REFERENCES "users"("id") ON DELETE RESTRICT,
  "created_at" timestamptz(6) NOT NULL DEFAULT now(),
  CONSTRAINT "referral_campaigns_window" CHECK ("starts_at" IS NULL OR "ends_at" IS NULL OR "ends_at" > "starts_at"),
  CONSTRAINT "referral_campaigns_cap" CHECK ("max_signups" IS NULL OR "signups" <= "max_signups")
);

CREATE TABLE "referral_codes" (
  "code" varchar(40) PRIMARY KEY CHECK ("code" ~ '^[A-Z0-9][A-Z0-9-]{2,39}$'),
  "vendor_id" uuid UNIQUE REFERENCES "vendors"("id") ON DELETE CASCADE,
  "campaign_id" uuid UNIQUE REFERENCES "referral_campaigns"("id") ON DELETE CASCADE,
  "created_at" timestamptz(6) NOT NULL DEFAULT now(),
  CONSTRAINT "referral_codes_one_owner" CHECK (("vendor_id" IS NULL) <> ("campaign_id" IS NULL))
);

CREATE TYPE "referral_status" AS ENUM ('REGISTERED', 'REWARDED', 'VOID');

CREATE TABLE "referrals" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "referred_vendor_id" uuid NOT NULL UNIQUE REFERENCES "vendors"("id") ON DELETE CASCADE,
  "referrer_vendor_id" uuid REFERENCES "vendors"("id") ON DELETE SET NULL,
  "campaign_id" uuid REFERENCES "referral_campaigns"("id") ON DELETE SET NULL,
  "code_used" varchar(40) NOT NULL,
  "country_code" char(2) NOT NULL REFERENCES "countries"("code") ON DELETE RESTRICT,
  "status" "referral_status" NOT NULL DEFAULT 'REGISTERED',
  "referrer_credit_minor" bigint NOT NULL DEFAULT 0 CHECK ("referrer_credit_minor" >= 0),
  "referee_credit_minor" bigint NOT NULL DEFAULT 0 CHECK ("referee_credit_minor" >= 0),
  "void_reason" varchar(200),
  "rewarded_at" timestamptz(6),
  "created_at" timestamptz(6) NOT NULL DEFAULT now(),
  CONSTRAINT "referrals_not_self" CHECK ("referrer_vendor_id" IS NULL OR "referrer_vendor_id" <> "referred_vendor_id"),
  CONSTRAINT "referrals_rewarded" CHECK ("status" <> 'REWARDED' OR "rewarded_at" IS NOT NULL)
);
CREATE INDEX "referrals_referrer_idx" ON "referrals" ("referrer_vendor_id", "created_at");
CREATE INDEX "referrals_status_idx" ON "referrals" ("status");

ALTER TABLE "vendors" ADD COLUMN "signup_referral_code" varchar(40);
CREATE INDEX "vendors_signup_referral_idx" ON "vendors" ("created_at") WHERE "signup_referral_code" IS NOT NULL;
