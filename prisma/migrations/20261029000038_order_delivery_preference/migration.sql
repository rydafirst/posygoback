CREATE TYPE "delivery_preference" AS ENUM ('CHEAPEST', 'FASTEST');

ALTER TABLE "orders" ADD COLUMN "delivery_preference" "delivery_preference" NOT NULL DEFAULT 'CHEAPEST';
