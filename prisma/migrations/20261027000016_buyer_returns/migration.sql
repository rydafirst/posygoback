ALTER TABLE "storefront_orders" ADD COLUMN "returns_until" timestamptz(6);

UPDATE "storefront_orders" o
SET "returns_until" = o."paid_at" + make_interval(days => s."return_window_days")
FROM "storefronts" s
WHERE s."vendor_id" = o."vendor_id" AND s."returns_allowed" AND o."paid_at" IS NOT NULL;

ALTER TABLE "storefront_orders" ADD CONSTRAINT "storefront_orders_returns_after_payment" CHECK ("returns_until" IS NULL OR ("paid_at" IS NOT NULL AND "returns_until" > "paid_at"));

CREATE INDEX "storefront_orders_buyer_account_idx" ON "storefront_orders" ("buyer_id", "created_at");
CREATE INDEX "storefront_returns_status_idx" ON "storefront_returns" ("status", "created_at");
CREATE INDEX "discount_codes_vendor_idx" ON "discount_codes" ("vendor_id", "created_at");
