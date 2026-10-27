CREATE TYPE "support_case_kind" AS ENUM ('ERROR', 'QUESTION');
CREATE TYPE "support_case_status" AS ENUM ('OPEN', 'RESOLVED');

CREATE TABLE "support_cases" (
  "id" uuid NOT NULL DEFAULT gen_random_uuid(),
  "reference" varchar(20) NOT NULL,
  "kind" "support_case_kind" NOT NULL,
  "status" "support_case_status" NOT NULL DEFAULT 'OPEN',
  "fingerprint" char(64),
  "page" varchar(300) NOT NULL,
  "error_code" varchar(60),
  "error_status" integer,
  "endpoint" varchar(200),
  "report_count" integer NOT NULL DEFAULT 1,
  "first_seen_at" timestamptz(6) NOT NULL DEFAULT now(),
  "last_seen_at" timestamptz(6) NOT NULL DEFAULT now(),
  "resolved_at" timestamptz(6),
  "resolved_by" uuid,
  "resolution_note" varchar(500),
  PRIMARY KEY ("id"),
  CONSTRAINT "support_cases_resolved_by_fkey" FOREIGN KEY ("resolved_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE NO ACTION,
  CONSTRAINT "support_cases_report_count_positive" CHECK ("report_count" > 0),
  CONSTRAINT "support_cases_resolution_complete" CHECK (("status" = 'RESOLVED') = ("resolved_at" IS NOT NULL))
);
CREATE UNIQUE INDEX "support_cases_reference_key" ON "support_cases" ("reference");
CREATE INDEX "support_cases_status_idx" ON "support_cases" ("status", "last_seen_at");
CREATE INDEX "support_cases_fingerprint_idx" ON "support_cases" ("fingerprint", "status");

CREATE TABLE "support_reports" (
  "id" uuid NOT NULL DEFAULT gen_random_uuid(),
  "case_id" uuid NOT NULL,
  "user_id" uuid,
  "contact_email" varchar(254),
  "message" varchar(1000) NOT NULL,
  "correlation_id" uuid,
  "trail" jsonb NOT NULL DEFAULT '[]',
  "user_agent" varchar(512),
  "created_at" timestamptz(6) NOT NULL DEFAULT now(),
  PRIMARY KEY ("id"),
  CONSTRAINT "support_reports_case_id_fkey" FOREIGN KEY ("case_id") REFERENCES "support_cases"("id") ON DELETE CASCADE ON UPDATE NO ACTION,
  CONSTRAINT "support_reports_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE NO ACTION
);
CREATE INDEX "support_reports_case_idx" ON "support_reports" ("case_id", "created_at");
CREATE INDEX "support_reports_user_idx" ON "support_reports" ("user_id");
