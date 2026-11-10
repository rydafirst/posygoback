ALTER TYPE "shipping_mode" ADD VALUE IF NOT EXISTS 'POSYGO_BOXES';

ALTER TABLE "storage_boxes" ADD COLUMN "supplied" boolean DEFAULT false NOT NULL;
ALTER TABLE "storage_boxes" ADD COLUMN "closed_reason" varchar(20);
ALTER TABLE "storage_boxes" ADD CONSTRAINT "storage_boxes_closed_reason" CHECK (("removed_at" IS NULL) = ("closed_reason" IS NULL));
CREATE INDEX "storage_boxes_open_idx" ON "storage_boxes" ("vendor_id", "warehouse_id") WHERE "removed_at" IS NULL;

CREATE TABLE "box_repacks" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "vendor_id" uuid NOT NULL,
  "warehouse_id" uuid NOT NULL,
  "before_counts" jsonb NOT NULL,
  "after_counts" jsonb NOT NULL,
  "photo_file_ids" uuid[] NOT NULL,
  "note" varchar(500),
  "created_by" uuid NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "box_repacks_has_photos" CHECK (cardinality("photo_file_ids") > 0)
);
CREATE INDEX "box_repacks_vendor_idx" ON "box_repacks" ("vendor_id", "created_at");
ALTER TABLE "box_repacks" ADD CONSTRAINT "box_repacks_vendor_fk" FOREIGN KEY ("vendor_id") REFERENCES "vendors"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;
ALTER TABLE "box_repacks" ADD CONSTRAINT "box_repacks_warehouse_fk" FOREIGN KEY ("warehouse_id") REFERENCES "warehouses"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;
ALTER TABLE "box_repacks" ADD CONSTRAINT "box_repacks_created_by_fk" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;
