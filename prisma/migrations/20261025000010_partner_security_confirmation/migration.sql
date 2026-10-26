ALTER TABLE "partner_securities" ADD COLUMN "confirmed_by" uuid REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;
ALTER TABLE "partner_securities" ADD COLUMN "confirmed_at" timestamptz(6);
ALTER TABLE "partner_securities" ADD CONSTRAINT "partner_securities_confirmed_checked" CHECK ("confirmed_by" IS NULL OR "confirmed_by" <> "recorded_by");
ALTER TABLE "partner_securities" ADD CONSTRAINT "partner_securities_confirmed_together" CHECK (("confirmed_by" IS NULL) = ("confirmed_at" IS NULL));
