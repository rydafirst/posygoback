ALTER TABLE "shopping_requests"
  ADD COLUMN "confirm_token_hash" varchar(64) UNIQUE,
  ADD COLUMN "confirm_expires_at" timestamptz(6),
  ADD COLUMN "confirmed_at" timestamptz(6),
  ADD COLUMN "dispute_open" boolean NOT NULL DEFAULT false,
  ADD COLUMN "label_claimed_at" timestamptz(6);

UPDATE "shopping_requests" SET "confirmed_at" = "created_at";

ALTER TABLE "shopping_requests"
  ADD CONSTRAINT "shopping_requests_confirmed" CHECK ("status" IN ('REQUESTED', 'CANCELLED') OR "confirmed_at" IS NOT NULL);

CREATE INDEX "shopping_requests_unconfirmed_idx" ON "shopping_requests" ("confirm_expires_at") WHERE "confirmed_at" IS NULL;
CREATE INDEX "shopping_refunds_retry_idx" ON "shopping_refunds" ("status", "updated_at") WHERE "status" <> 'SUCCEEDED';
