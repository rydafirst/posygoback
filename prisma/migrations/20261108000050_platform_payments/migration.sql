CREATE TABLE "platform_settings" (
  "id" SMALLINT PRIMARY KEY DEFAULT 1 CHECK ("id" = 1),
  "activation_fee_minor" BIGINT NOT NULL DEFAULT 1000 CHECK ("activation_fee_minor" >= 0),
  "activation_fee_currency" CHAR(3) NOT NULL DEFAULT 'USD',
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT now()
);
INSERT INTO "platform_settings" ("id") VALUES (1);

ALTER TABLE "top_ups" ADD COLUMN "account_key" VARCHAR(10);
UPDATE "top_ups" SET "account_key" = "country_code";
ALTER TABLE "top_ups" ALTER COLUMN "account_key" SET NOT NULL;

ALTER TABLE "vendor_activation_payments" ADD COLUMN "account_key" VARCHAR(10);
UPDATE "vendor_activation_payments" SET "account_key" = "country_code";
ALTER TABLE "vendor_activation_payments" ALTER COLUMN "account_key" SET NOT NULL;

UPDATE "countries" SET "config" = "config" - 'activationFeeMinor';
