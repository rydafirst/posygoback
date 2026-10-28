ALTER TABLE "vendors" ADD COLUMN "activation_due_at" timestamptz(6);

CREATE TYPE "activation_payment_status" AS ENUM ('PENDING', 'PAID', 'FAILED', 'EXPIRED', 'REFUNDED');

CREATE TABLE "vendor_activation_payments" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "vendor_id" uuid NOT NULL,
  "country_code" char(2) NOT NULL,
  "processor" varchar(20) NOT NULL,
  "provider_reference" varchar(255),
  "provider_payment_id" varchar(255),
  "currency" char(3) NOT NULL,
  "fee_minor" bigint NOT NULL,
  "paid_minor" bigint,
  "status" "activation_payment_status" DEFAULT 'PENDING' NOT NULL,
  "created_at" timestamptz(6) DEFAULT now() NOT NULL,
  "paid_at" timestamptz(6),
  "closed_at" timestamptz(6),
  CONSTRAINT "vendor_activation_payments_fee_positive" CHECK ("fee_minor" > 0),
  CONSTRAINT "vendor_activation_payments_paid_complete" CHECK (("status" IN ('PAID', 'REFUNDED')) = ("paid_at" IS NOT NULL AND "paid_minor" IS NOT NULL AND "provider_payment_id" IS NOT NULL))
);
CREATE UNIQUE INDEX "vendor_activation_payments_provider_reference_unique" ON "vendor_activation_payments" ("provider_reference");
CREATE UNIQUE INDEX "vendor_activation_payments_provider_payment_unique" ON "vendor_activation_payments" ("provider_payment_id");
CREATE UNIQUE INDEX "vendor_activation_payments_one_paid" ON "vendor_activation_payments" ("vendor_id") WHERE "status" = 'PAID';
CREATE INDEX "vendor_activation_payments_vendor_created_idx" ON "vendor_activation_payments" ("vendor_id", "created_at");
ALTER TABLE "vendor_activation_payments" ADD CONSTRAINT "vendor_activation_payments_vendor_id_vendors_id_fk" FOREIGN KEY ("vendor_id") REFERENCES "vendors"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;
ALTER TABLE "vendor_activation_payments" ADD CONSTRAINT "vendor_activation_payments_country_code_countries_code_fk" FOREIGN KEY ("country_code") REFERENCES "countries"("code") ON DELETE RESTRICT ON UPDATE NO ACTION;

UPDATE "countries" SET "config" = jsonb_set("config", '{activationFeeMinor}', '0') WHERE NOT ("config" ? 'activationFeeMinor');
