CREATE TABLE "vendor_countries" (
  "vendor_id" uuid NOT NULL,
  "country_code" char(2) NOT NULL,
  "created_at" timestamptz(6) DEFAULT now() NOT NULL,
  CONSTRAINT "vendor_countries_vendor_id_country_code_pk" PRIMARY KEY ("vendor_id", "country_code")
);
CREATE INDEX "vendor_countries_country_idx" ON "vendor_countries" ("country_code");
ALTER TABLE "vendor_countries" ADD CONSTRAINT "vendor_countries_vendor_id_vendors_id_fk" FOREIGN KEY ("vendor_id") REFERENCES "vendors"("id") ON DELETE CASCADE ON UPDATE NO ACTION;
ALTER TABLE "vendor_countries" ADD CONSTRAINT "vendor_countries_country_code_countries_code_fk" FOREIGN KEY ("country_code") REFERENCES "countries"("code") ON DELETE RESTRICT ON UPDATE NO ACTION;

INSERT INTO "vendor_countries" ("vendor_id", "country_code", "created_at")
SELECT "id", "country_code", "created_at" FROM "vendors"
ON CONFLICT DO NOTHING;

CREATE OR REPLACE FUNCTION vendor_home_country()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  INSERT INTO vendor_countries (vendor_id, country_code) VALUES (NEW.id, NEW.country_code) ON CONFLICT DO NOTHING;
  RETURN NEW;
END;
$$;

CREATE TRIGGER vendors_home_country_after_write
AFTER INSERT OR UPDATE OF country_code ON vendors
FOR EACH ROW EXECUTE FUNCTION vendor_home_country();

ALTER TABLE "order_import_batches" ADD COLUMN "country_code" char(2);
UPDATE "order_import_batches" AS b SET "country_code" = v."country_code" FROM "vendors" AS v WHERE v."id" = b."vendor_id";
ALTER TABLE "order_import_batches" ALTER COLUMN "country_code" SET NOT NULL;
ALTER TABLE "order_import_batches" ADD CONSTRAINT "order_import_batches_country_code_countries_code_fk" FOREIGN KEY ("country_code") REFERENCES "countries"("code") ON DELETE RESTRICT ON UPDATE NO ACTION;
