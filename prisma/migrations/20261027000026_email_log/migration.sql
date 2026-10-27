CREATE TYPE "email_status" AS ENUM ('SENT', 'FAILED');

CREATE TABLE "email_log" (
  "id" uuid NOT NULL DEFAULT gen_random_uuid(),
  "to_address" varchar(254) NOT NULL,
  "kind" varchar(60) NOT NULL,
  "subject" varchar(200) NOT NULL,
  "status" "email_status" NOT NULL,
  "provider_id" varchar(100),
  "error" varchar(300),
  "created_at" timestamptz(6) NOT NULL DEFAULT now(),
  PRIMARY KEY ("id")
);
CREATE INDEX "email_log_to_idx" ON "email_log" ("to_address", "created_at");
CREATE INDEX "email_log_created_idx" ON "email_log" ("created_at");
