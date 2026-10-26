CREATE TABLE "notifications" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "vendor_id" uuid REFERENCES "vendors"("id") ON DELETE CASCADE,
  "user_id" uuid REFERENCES "users"("id") ON DELETE CASCADE,
  "title" varchar(160) NOT NULL,
  "body" varchar(400) NOT NULL,
  "href" varchar(200) CHECK ("href" IS NULL OR "href" ~ '^/[A-Za-z0-9/_?=&.-]*$'),
  "read_at" timestamptz(6),
  "created_at" timestamptz(6) NOT NULL DEFAULT now(),
  CONSTRAINT "notifications_one_audience" CHECK (("vendor_id" IS NULL) <> ("user_id" IS NULL))
);
CREATE INDEX "notifications_vendor_idx" ON "notifications" ("vendor_id", "created_at" DESC) WHERE "vendor_id" IS NOT NULL;
CREATE INDEX "notifications_user_idx" ON "notifications" ("user_id", "created_at" DESC) WHERE "user_id" IS NOT NULL;
