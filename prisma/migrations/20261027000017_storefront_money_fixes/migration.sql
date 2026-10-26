CREATE TABLE "storefront_refunds" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "storefront_order_id" uuid NOT NULL REFERENCES "storefront_orders"("id") ON DELETE RESTRICT,
  "intent_key" varchar(120) NOT NULL UNIQUE,
  "amount_minor" bigint NOT NULL CHECK ("amount_minor" > 0),
  "status" varchar(16) NOT NULL DEFAULT 'PENDING' CHECK ("status" IN ('PENDING', 'SUCCEEDED', 'FAILED')),
  "provider_refund_id" varchar(255) UNIQUE,
  "reason" varchar(500) NOT NULL,
  "created_at" timestamptz(6) NOT NULL DEFAULT now(),
  "updated_at" timestamptz(6) NOT NULL DEFAULT now(),
  CONSTRAINT "storefront_refunds_settled" CHECK ("status" <> 'SUCCEEDED' OR "provider_refund_id" IS NOT NULL)
);
CREATE INDEX "storefront_refunds_order_idx" ON "storefront_refunds" ("storefront_order_id");

ALTER TABLE "storefront_orders" ADD COLUMN "shipped_at" timestamptz(6);
ALTER TABLE "storefront_orders" ADD COLUMN "dispute_open" boolean NOT NULL DEFAULT false;

UPDATE "storefront_orders" SET "shipped_at" = COALESCE("paid_at", "created_at") WHERE "status" IN ('SHIPPED', 'DELIVERED');
UPDATE "storefront_orders" SET "payout_release_at" = NULL, "returns_until" = NULL WHERE "status" IN ('PAID', 'AWAITING_VENDOR_FUNDS', 'FULFILLING') AND "payout_status" = 'HELD';

ALTER TABLE "storefront_orders" DROP CONSTRAINT "storefront_orders_returns_after_payment";
ALTER TABLE "storefront_orders" ADD CONSTRAINT "storefront_orders_returns_after_shipping" CHECK ("returns_until" IS NULL OR ("shipped_at" IS NOT NULL AND "returns_until" > "shipped_at"));
