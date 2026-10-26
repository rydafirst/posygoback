ALTER TABLE "vendors" ADD COLUMN "is_test_account" boolean NOT NULL DEFAULT false;

ALTER TABLE "mystery_orders" ADD CONSTRAINT "mystery_orders_assessor_not_creator" CHECK ("assessed_by" IS NULL OR "assessed_by" <> "created_by");

CREATE UNIQUE INDEX "stock_counts_video_unique" ON "stock_counts" ("video_file_id") WHERE "video_file_id" IS NOT NULL;

ALTER TABLE "fulfilment_partners" ADD COLUMN "tier_set_manually_at" timestamptz;
