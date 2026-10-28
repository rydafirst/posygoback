CREATE TABLE "form_drafts" (
  "user_id" uuid NOT NULL,
  "form_key" varchar(80) NOT NULL,
  "data" jsonb NOT NULL,
  "updated_at" timestamptz(6) DEFAULT now() NOT NULL,
  CONSTRAINT "form_drafts_pkey" PRIMARY KEY ("user_id", "form_key"),
  CONSTRAINT "form_drafts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE NO ACTION
);
CREATE INDEX "form_drafts_updated_idx" ON "form_drafts" ("updated_at");
