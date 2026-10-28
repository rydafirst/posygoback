ALTER TABLE "support_cases" ADD COLUMN "source" varchar(10) DEFAULT 'HELPER' NOT NULL;
ALTER TABLE "support_cases" ADD CONSTRAINT "support_cases_source_check" CHECK ("source" IN ('HELPER', 'SERVER'));
CREATE INDEX "support_reports_correlation_idx" ON "support_reports" ("correlation_id");
