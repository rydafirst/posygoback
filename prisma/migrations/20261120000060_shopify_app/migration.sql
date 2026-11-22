CREATE TYPE "shopify_request_outcome" AS ENUM ('ACCEPTED', 'REJECTED', 'FULFILLED', 'CLOSED', 'CANCELLED');

CREATE TABLE "shopify_shops" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "shop_domain" VARCHAR(255) NOT NULL,
    "access_token_encrypted" TEXT,
    "scopes" VARCHAR(500) NOT NULL DEFAULT '',
    "vendor_id" UUID,
    "api_key_id" UUID,
    "country" CHAR(2),
    "fulfillment_service_id" VARCHAR(120),
    "location_id" VARCHAR(120),
    "installed_at" TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
    "uninstalled_at" TIMESTAMPTZ(6),
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
    CONSTRAINT "shopify_shops_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "shopify_shops_domain_unique" ON "shopify_shops"("shop_domain");
CREATE INDEX "shopify_shops_vendor_idx" ON "shopify_shops"("vendor_id");
ALTER TABLE "shopify_shops" ADD CONSTRAINT "shopify_shops_vendor_id_fkey" FOREIGN KEY ("vendor_id") REFERENCES "vendors"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;
ALTER TABLE "shopify_shops" ADD CONSTRAINT "shopify_shops_api_key_id_fkey" FOREIGN KEY ("api_key_id") REFERENCES "api_keys"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;

CREATE TABLE "shopify_fulfilment_requests" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "shop_id" UUID NOT NULL,
    "fulfillment_order_id" VARCHAR(120) NOT NULL,
    "order_name" VARCHAR(60) NOT NULL,
    "order_id" UUID,
    "outcome" "shopify_request_outcome" NOT NULL,
    "message" VARCHAR(300) NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
    CONSTRAINT "shopify_fulfilment_requests_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "shopify_requests_fulfillment_order_unique" ON "shopify_fulfilment_requests"("fulfillment_order_id");
CREATE UNIQUE INDEX "shopify_requests_order_unique" ON "shopify_fulfilment_requests"("order_id");
CREATE INDEX "shopify_requests_outcome_idx" ON "shopify_fulfilment_requests"("outcome");
CREATE INDEX "shopify_requests_shop_idx" ON "shopify_fulfilment_requests"("shop_id", "created_at" DESC);
ALTER TABLE "shopify_fulfilment_requests" ADD CONSTRAINT "shopify_fulfilment_requests_shop_id_fkey" FOREIGN KEY ("shop_id") REFERENCES "shopify_shops"("id") ON DELETE CASCADE ON UPDATE NO ACTION;
ALTER TABLE "shopify_fulfilment_requests" ADD CONSTRAINT "shopify_fulfilment_requests_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;
