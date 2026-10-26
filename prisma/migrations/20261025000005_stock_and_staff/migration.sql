CREATE TYPE "public"."barcode_symbology" AS ENUM('EAN13', 'UPC_A', 'GTIN14', 'CODE128');
CREATE TYPE "public"."custody_event_type" AS ENUM('RECEIVED', 'PUT_AWAY', 'MOVED');
CREATE TYPE "public"."inbound_status" AS ENUM('DRAFT', 'SUBMITTED', 'ARRIVED', 'ON_HOLD', 'RECEIVED', 'DISCREPANCY', 'REJECTED', 'RETURN_REQUESTED', 'CANCELLED');
CREATE TYPE "public"."lot_condition" AS ENUM('SELLABLE', 'DAMAGED');
CREATE TYPE "public"."movement_type" AS ENUM('RECEIVE', 'PUT_AWAY', 'MOVE', 'RESERVE', 'RELEASE', 'SHIP', 'ADJUST');
CREATE TYPE "public"."product_status" AS ENUM('ACTIVE', 'ARCHIVED');
CREATE TYPE "public"."shipping_mode" AS ENUM('LOOSE', 'PALLET');
CREATE TYPE "public"."storage_tier" AS ENUM('SMALL', 'MEDIUM', 'LARGE', 'X_LARGE', 'PALLET');
ALTER TYPE "public"."file_purpose" ADD VALUE 'PRODUCT_IMAGE' BEFORE 'LABEL_DOCUMENT';
CREATE TABLE "custody_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"sequence" bigserial NOT NULL,
	"warehouse_id" uuid NOT NULL,
	"vendor_id" uuid NOT NULL,
	"lot_id" uuid NOT NULL,
	"type" "custody_event_type" NOT NULL,
	"quantity" integer NOT NULL,
	"from_location_id" uuid,
	"to_location_id" uuid,
	"actor_id" uuid NOT NULL,
	"evidence_file_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"prev_hash" char(64) DEFAULT '' NOT NULL,
	"hash" char(64) DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "custody_events_sequence_unique" UNIQUE("sequence")
);

CREATE TABLE "inbound_lines" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"inbound_id" uuid NOT NULL,
	"product_id" uuid NOT NULL,
	"declared_quantity" integer NOT NULL,
	"accepted_quantity" integer DEFAULT 0 NOT NULL,
	"damaged_quantity" integer DEFAULT 0 NOT NULL,
	"note" varchar(500),
	CONSTRAINT "inbound_lines_declared_positive" CHECK ("inbound_lines"."declared_quantity" > 0),
	CONSTRAINT "inbound_lines_counts_non_negative" CHECK ("inbound_lines"."accepted_quantity" >= 0 AND "inbound_lines"."damaged_quantity" >= 0)
);

CREATE TABLE "inbound_messages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"inbound_id" uuid NOT NULL,
	"author_user_id" uuid NOT NULL,
	"from_platform" boolean NOT NULL,
	"body" varchar(2000) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE "inbound_photos" (
	"file_id" uuid PRIMARY KEY NOT NULL,
	"inbound_id" uuid NOT NULL,
	"line_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE "inbound_shipments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"reference" varchar(20) NOT NULL,
	"vendor_id" uuid NOT NULL,
	"warehouse_id" uuid NOT NULL,
	"country_code" char(2) NOT NULL,
	"status" "inbound_status" DEFAULT 'DRAFT' NOT NULL,
	"shipping_mode" "shipping_mode" NOT NULL,
	"expected_arrival_date" date NOT NULL,
	"carrier" varchar(60),
	"tracking_number" varchar(60),
	"notes" varchar(1000),
	"declared_box_counts" jsonb NOT NULL,
	"received_box_counts" jsonb,
	"status_reason" varchar(1000),
	"receiving_note" varchar(1000),
	"created_by" uuid NOT NULL,
	"received_by" uuid,
	"submitted_at" timestamp with time zone,
	"arrived_at" timestamp with time zone,
	"received_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "inbound_shipments_reference_unique" UNIQUE("reference")
);

CREATE TABLE "inventory_locations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"warehouse_id" uuid NOT NULL,
	"code" varchar(32) NOT NULL,
	"label" varchar(80) NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE "inventory_movements" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"vendor_id" uuid NOT NULL,
	"warehouse_id" uuid NOT NULL,
	"lot_id" uuid NOT NULL,
	"type" "movement_type" NOT NULL,
	"delta_available" integer DEFAULT 0 NOT NULL,
	"delta_reserved" integer DEFAULT 0 NOT NULL,
	"reason" varchar(500),
	"reference_type" varchar(40),
	"reference_id" uuid,
	"actor_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE "product_barcodes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"product_id" uuid NOT NULL,
	"vendor_id" uuid NOT NULL,
	"value" varchar(48) NOT NULL,
	"symbology" "barcode_symbology" NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE "products" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"vendor_id" uuid NOT NULL,
	"code" varchar(40) NOT NULL,
	"name" varchar(120) NOT NULL,
	"variant_label" varchar(60),
	"hs_code" varchar(10),
	"country_of_origin" char(2) NOT NULL,
	"declared_value_minor" integer NOT NULL,
	"currency" char(3) NOT NULL,
	"weight_grams" integer NOT NULL,
	"length_mm" integer,
	"width_mm" integer,
	"height_mm" integer,
	"storage_tier" "storage_tier" NOT NULL,
	"image_file_id" uuid,
	"status" "product_status" DEFAULT 'ACTIVE' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "products_value_non_negative" CHECK ("products"."declared_value_minor" >= 0),
	CONSTRAINT "products_weight_positive" CHECK ("products"."weight_grams" > 0)
);

CREATE TABLE "staff_invitations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" varchar(254) NOT NULL,
	"role" "role" NOT NULL,
	"country_code" char(2),
	"token_hash" char(64) NOT NULL,
	"status" "invitation_status" DEFAULT 'PENDING' NOT NULL,
	"invited_by" uuid NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"accepted_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "staff_invitations_token_hash_unique" UNIQUE("token_hash"),
	CONSTRAINT "staff_invitations_email_lowercase" CHECK ("staff_invitations"."email" = lower("staff_invitations"."email")),
	CONSTRAINT "staff_invitations_not_vendor_role" CHECK ("staff_invitations"."role" NOT IN ('VENDOR_OWNER','VENDOR_MEMBER','SUPER_ADMIN'))
);

CREATE TABLE "stock_lots" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code" varchar(64) NOT NULL,
	"vendor_id" uuid NOT NULL,
	"product_id" uuid NOT NULL,
	"warehouse_id" uuid NOT NULL,
	"inbound_id" uuid NOT NULL,
	"condition" "lot_condition" NOT NULL,
	"storage_tier" "storage_tier" NOT NULL,
	"quantity_available" integer NOT NULL,
	"quantity_reserved" integer DEFAULT 0 NOT NULL,
	"location_id" uuid,
	"received_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "stock_lots_code_unique" UNIQUE("code"),
	CONSTRAINT "stock_lots_quantities_non_negative" CHECK ("stock_lots"."quantity_available" >= 0 AND "stock_lots"."quantity_reserved" >= 0)
);

CREATE TABLE "storage_boxes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"vendor_id" uuid NOT NULL,
	"warehouse_id" uuid NOT NULL,
	"inbound_id" uuid NOT NULL,
	"tier" "storage_tier" NOT NULL,
	"received_at" timestamp with time zone NOT NULL,
	"removed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE "warehouses" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"country_code" char(2) NOT NULL,
	"code" varchar(16) NOT NULL,
	"name" varchar(80) NOT NULL,
	"address_lines" jsonb NOT NULL,
	"city" varchar(80) NOT NULL,
	"postal_code" varchar(16) NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "warehouses_code_unique" UNIQUE("code")
);

ALTER TABLE "custody_events" ADD CONSTRAINT "custody_events_warehouse_id_warehouses_id_fk" FOREIGN KEY ("warehouse_id") REFERENCES "public"."warehouses"("id") ON DELETE restrict ON UPDATE no action;
ALTER TABLE "custody_events" ADD CONSTRAINT "custody_events_vendor_id_vendors_id_fk" FOREIGN KEY ("vendor_id") REFERENCES "public"."vendors"("id") ON DELETE restrict ON UPDATE no action;
ALTER TABLE "custody_events" ADD CONSTRAINT "custody_events_lot_id_stock_lots_id_fk" FOREIGN KEY ("lot_id") REFERENCES "public"."stock_lots"("id") ON DELETE restrict ON UPDATE no action;
ALTER TABLE "custody_events" ADD CONSTRAINT "custody_events_from_location_id_inventory_locations_id_fk" FOREIGN KEY ("from_location_id") REFERENCES "public"."inventory_locations"("id") ON DELETE restrict ON UPDATE no action;
ALTER TABLE "custody_events" ADD CONSTRAINT "custody_events_to_location_id_inventory_locations_id_fk" FOREIGN KEY ("to_location_id") REFERENCES "public"."inventory_locations"("id") ON DELETE restrict ON UPDATE no action;
ALTER TABLE "custody_events" ADD CONSTRAINT "custody_events_actor_id_users_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;
ALTER TABLE "inbound_lines" ADD CONSTRAINT "inbound_lines_inbound_id_inbound_shipments_id_fk" FOREIGN KEY ("inbound_id") REFERENCES "public"."inbound_shipments"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "inbound_lines" ADD CONSTRAINT "inbound_lines_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE restrict ON UPDATE no action;
ALTER TABLE "inbound_messages" ADD CONSTRAINT "inbound_messages_inbound_id_inbound_shipments_id_fk" FOREIGN KEY ("inbound_id") REFERENCES "public"."inbound_shipments"("id") ON DELETE restrict ON UPDATE no action;
ALTER TABLE "inbound_messages" ADD CONSTRAINT "inbound_messages_author_user_id_users_id_fk" FOREIGN KEY ("author_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;
ALTER TABLE "inbound_photos" ADD CONSTRAINT "inbound_photos_file_id_stored_files_id_fk" FOREIGN KEY ("file_id") REFERENCES "public"."stored_files"("id") ON DELETE restrict ON UPDATE no action;
ALTER TABLE "inbound_photos" ADD CONSTRAINT "inbound_photos_inbound_id_inbound_shipments_id_fk" FOREIGN KEY ("inbound_id") REFERENCES "public"."inbound_shipments"("id") ON DELETE restrict ON UPDATE no action;
ALTER TABLE "inbound_photos" ADD CONSTRAINT "inbound_photos_line_id_inbound_lines_id_fk" FOREIGN KEY ("line_id") REFERENCES "public"."inbound_lines"("id") ON DELETE restrict ON UPDATE no action;
ALTER TABLE "inbound_shipments" ADD CONSTRAINT "inbound_shipments_vendor_id_vendors_id_fk" FOREIGN KEY ("vendor_id") REFERENCES "public"."vendors"("id") ON DELETE restrict ON UPDATE no action;
ALTER TABLE "inbound_shipments" ADD CONSTRAINT "inbound_shipments_warehouse_id_warehouses_id_fk" FOREIGN KEY ("warehouse_id") REFERENCES "public"."warehouses"("id") ON DELETE restrict ON UPDATE no action;
ALTER TABLE "inbound_shipments" ADD CONSTRAINT "inbound_shipments_country_code_countries_code_fk" FOREIGN KEY ("country_code") REFERENCES "public"."countries"("code") ON DELETE restrict ON UPDATE no action;
ALTER TABLE "inbound_shipments" ADD CONSTRAINT "inbound_shipments_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;
ALTER TABLE "inbound_shipments" ADD CONSTRAINT "inbound_shipments_received_by_users_id_fk" FOREIGN KEY ("received_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;
ALTER TABLE "inventory_locations" ADD CONSTRAINT "inventory_locations_warehouse_id_warehouses_id_fk" FOREIGN KEY ("warehouse_id") REFERENCES "public"."warehouses"("id") ON DELETE restrict ON UPDATE no action;
ALTER TABLE "inventory_movements" ADD CONSTRAINT "inventory_movements_vendor_id_vendors_id_fk" FOREIGN KEY ("vendor_id") REFERENCES "public"."vendors"("id") ON DELETE restrict ON UPDATE no action;
ALTER TABLE "inventory_movements" ADD CONSTRAINT "inventory_movements_warehouse_id_warehouses_id_fk" FOREIGN KEY ("warehouse_id") REFERENCES "public"."warehouses"("id") ON DELETE restrict ON UPDATE no action;
ALTER TABLE "inventory_movements" ADD CONSTRAINT "inventory_movements_lot_id_stock_lots_id_fk" FOREIGN KEY ("lot_id") REFERENCES "public"."stock_lots"("id") ON DELETE restrict ON UPDATE no action;
ALTER TABLE "inventory_movements" ADD CONSTRAINT "inventory_movements_actor_id_users_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;
ALTER TABLE "product_barcodes" ADD CONSTRAINT "product_barcodes_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "product_barcodes" ADD CONSTRAINT "product_barcodes_vendor_id_vendors_id_fk" FOREIGN KEY ("vendor_id") REFERENCES "public"."vendors"("id") ON DELETE restrict ON UPDATE no action;
ALTER TABLE "products" ADD CONSTRAINT "products_vendor_id_vendors_id_fk" FOREIGN KEY ("vendor_id") REFERENCES "public"."vendors"("id") ON DELETE restrict ON UPDATE no action;
ALTER TABLE "products" ADD CONSTRAINT "products_image_file_id_stored_files_id_fk" FOREIGN KEY ("image_file_id") REFERENCES "public"."stored_files"("id") ON DELETE restrict ON UPDATE no action;
ALTER TABLE "staff_invitations" ADD CONSTRAINT "staff_invitations_country_code_countries_code_fk" FOREIGN KEY ("country_code") REFERENCES "public"."countries"("code") ON DELETE restrict ON UPDATE no action;
ALTER TABLE "staff_invitations" ADD CONSTRAINT "staff_invitations_invited_by_users_id_fk" FOREIGN KEY ("invited_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;
ALTER TABLE "stock_lots" ADD CONSTRAINT "stock_lots_vendor_id_vendors_id_fk" FOREIGN KEY ("vendor_id") REFERENCES "public"."vendors"("id") ON DELETE restrict ON UPDATE no action;
ALTER TABLE "stock_lots" ADD CONSTRAINT "stock_lots_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE restrict ON UPDATE no action;
ALTER TABLE "stock_lots" ADD CONSTRAINT "stock_lots_warehouse_id_warehouses_id_fk" FOREIGN KEY ("warehouse_id") REFERENCES "public"."warehouses"("id") ON DELETE restrict ON UPDATE no action;
ALTER TABLE "stock_lots" ADD CONSTRAINT "stock_lots_inbound_id_inbound_shipments_id_fk" FOREIGN KEY ("inbound_id") REFERENCES "public"."inbound_shipments"("id") ON DELETE restrict ON UPDATE no action;
ALTER TABLE "stock_lots" ADD CONSTRAINT "stock_lots_location_id_inventory_locations_id_fk" FOREIGN KEY ("location_id") REFERENCES "public"."inventory_locations"("id") ON DELETE restrict ON UPDATE no action;
ALTER TABLE "storage_boxes" ADD CONSTRAINT "storage_boxes_vendor_id_vendors_id_fk" FOREIGN KEY ("vendor_id") REFERENCES "public"."vendors"("id") ON DELETE restrict ON UPDATE no action;
ALTER TABLE "storage_boxes" ADD CONSTRAINT "storage_boxes_warehouse_id_warehouses_id_fk" FOREIGN KEY ("warehouse_id") REFERENCES "public"."warehouses"("id") ON DELETE restrict ON UPDATE no action;
ALTER TABLE "storage_boxes" ADD CONSTRAINT "storage_boxes_inbound_id_inbound_shipments_id_fk" FOREIGN KEY ("inbound_id") REFERENCES "public"."inbound_shipments"("id") ON DELETE restrict ON UPDATE no action;
ALTER TABLE "warehouses" ADD CONSTRAINT "warehouses_country_code_countries_code_fk" FOREIGN KEY ("country_code") REFERENCES "public"."countries"("code") ON DELETE restrict ON UPDATE no action;
CREATE INDEX "custody_events_lot_idx" ON "custody_events" USING btree ("lot_id","sequence");
CREATE INDEX "custody_events_warehouse_idx" ON "custody_events" USING btree ("warehouse_id","sequence");
CREATE UNIQUE INDEX "inbound_lines_product_unique" ON "inbound_lines" USING btree ("inbound_id","product_id");
CREATE INDEX "inbound_messages_inbound_idx" ON "inbound_messages" USING btree ("inbound_id","created_at");
CREATE INDEX "inbound_photos_inbound_idx" ON "inbound_photos" USING btree ("inbound_id");
CREATE INDEX "inbound_vendor_created_idx" ON "inbound_shipments" USING btree ("vendor_id","created_at");
CREATE INDEX "inbound_warehouse_status_idx" ON "inbound_shipments" USING btree ("warehouse_id","status","expected_arrival_date");
CREATE UNIQUE INDEX "inventory_locations_code_unique" ON "inventory_locations" USING btree ("warehouse_id","code");
CREATE INDEX "inventory_movements_vendor_created_idx" ON "inventory_movements" USING btree ("vendor_id","created_at");
CREATE INDEX "inventory_movements_lot_idx" ON "inventory_movements" USING btree ("lot_id","created_at");
CREATE UNIQUE INDEX "product_barcodes_vendor_value_unique" ON "product_barcodes" USING btree ("vendor_id","value");
CREATE INDEX "product_barcodes_product_idx" ON "product_barcodes" USING btree ("product_id");
CREATE UNIQUE INDEX "products_vendor_code_unique" ON "products" USING btree ("vendor_id","code");
CREATE INDEX "products_vendor_status_idx" ON "products" USING btree ("vendor_id","status");
CREATE UNIQUE INDEX "staff_invitations_one_pending_per_email" ON "staff_invitations" USING btree ("email") WHERE "staff_invitations"."status" = 'PENDING';
CREATE INDEX "stock_lots_vendor_product_idx" ON "stock_lots" USING btree ("vendor_id","product_id");
CREATE INDEX "stock_lots_warehouse_location_idx" ON "stock_lots" USING btree ("warehouse_id","location_id");
CREATE INDEX "storage_boxes_vendor_idx" ON "storage_boxes" USING btree ("vendor_id","removed_at");
CREATE INDEX "warehouses_country_idx" ON "warehouses" USING btree ("country_code","active");