ALTER TYPE "order_source" ADD VALUE IF NOT EXISTS 'SHOPIFY';
ALTER TYPE "order_source" ADD VALUE IF NOT EXISTS 'WOOCOMMERCE';

CREATE TYPE "store_platform" AS ENUM ('SHOPIFY', 'WOOCOMMERCE');
CREATE TYPE "store_delivery_outcome" AS ENUM ('CREATED', 'DUPLICATE', 'SKIPPED', 'FAILED');

CREATE TABLE "store_connections" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "vendor_id" UUID NOT NULL,
    "platform" "store_platform" NOT NULL,
    "name" VARCHAR(60) NOT NULL,
    "token" VARCHAR(48) NOT NULL,
    "secret_encrypted" TEXT,
    "created_by" UUID NOT NULL,
    "last_received_at" TIMESTAMPTZ(6),
    "revoked_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
    CONSTRAINT "store_connections_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "store_connections_token_unique" ON "store_connections"("token");
CREATE INDEX "store_connections_vendor_idx" ON "store_connections"("vendor_id", "revoked_at");
ALTER TABLE "store_connections" ADD CONSTRAINT "store_connections_vendor_id_fkey" FOREIGN KEY ("vendor_id") REFERENCES "vendors"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;
ALTER TABLE "store_connections" ADD CONSTRAINT "store_connections_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;

CREATE TABLE "store_deliveries" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "connection_id" UUID NOT NULL,
    "external_reference" VARCHAR(64),
    "outcome" "store_delivery_outcome" NOT NULL,
    "message" VARCHAR(300) NOT NULL,
    "order_reference" VARCHAR(32),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
    CONSTRAINT "store_deliveries_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "store_deliveries_connection_idx" ON "store_deliveries"("connection_id", "created_at" DESC);
ALTER TABLE "store_deliveries" ADD CONSTRAINT "store_deliveries_connection_id_fkey" FOREIGN KEY ("connection_id") REFERENCES "store_connections"("id") ON DELETE CASCADE ON UPDATE NO ACTION;
