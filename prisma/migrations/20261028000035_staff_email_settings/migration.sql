CREATE TABLE "staff_email_settings" (
  "topic" varchar(40) PRIMARY KEY NOT NULL,
  "enabled" boolean NOT NULL,
  "updated_by" uuid,
  "updated_at" timestamptz(6) DEFAULT now() NOT NULL,
  CONSTRAINT "staff_email_settings_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE NO ACTION
);
