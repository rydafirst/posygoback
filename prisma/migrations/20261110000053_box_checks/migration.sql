ALTER TABLE "inbound_shipments" ADD COLUMN "into_existing_boxes" boolean DEFAULT false NOT NULL;

CREATE TABLE "box_checks" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "vendor_id" uuid NOT NULL,
  "warehouse_id" uuid NOT NULL,
  "fullness_pct" smallint NOT NULL,
  "photo_file_ids" uuid[] NOT NULL,
  "note" varchar(500),
  "order_id" uuid,
  "created_by" uuid NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "box_checks_fullness" CHECK ("fullness_pct" IN (10, 25, 50, 75, 100)),
  CONSTRAINT "box_checks_has_photos" CHECK (cardinality("photo_file_ids") > 0)
);
CREATE INDEX "box_checks_latest_idx" ON "box_checks" ("vendor_id", "warehouse_id", "created_at");
ALTER TABLE "box_checks" ADD CONSTRAINT "box_checks_vendor_fk" FOREIGN KEY ("vendor_id") REFERENCES "vendors"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;
ALTER TABLE "box_checks" ADD CONSTRAINT "box_checks_warehouse_fk" FOREIGN KEY ("warehouse_id") REFERENCES "warehouses"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;
ALTER TABLE "box_checks" ADD CONSTRAINT "box_checks_order_fk" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;
ALTER TABLE "box_checks" ADD CONSTRAINT "box_checks_created_by_fk" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;
