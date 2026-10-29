CREATE TYPE "tax_cadence" AS ENUM ('ONCE', 'MONTHLY', 'QUARTERLY', 'YEARLY');
CREATE TYPE "tax_deadline_status" AS ENUM ('OPEN', 'FILED');

CREATE TABLE "tax_obligations" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "country_code" char(2) NOT NULL REFERENCES "countries" ("code") ON DELETE RESTRICT,
  "title" varchar(120) NOT NULL,
  "authority" varchar(120) NOT NULL,
  "description" varchar(1000) NOT NULL,
  "cadence" "tax_cadence" NOT NULL,
  "due_rule" varchar(200) NOT NULL,
  "guidance_url" varchar(500),
  "owner" varchar(120),
  "confirmed" boolean DEFAULT false NOT NULL,
  "active" boolean DEFAULT true NOT NULL,
  "created_by" uuid,
  "created_at" timestamptz(6) DEFAULT now() NOT NULL,
  "updated_at" timestamptz(6) DEFAULT now() NOT NULL
);
CREATE INDEX "tax_obligations_country_idx" ON "tax_obligations" ("country_code", "active");

CREATE TABLE "tax_deadlines" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "obligation_id" uuid NOT NULL REFERENCES "tax_obligations" ("id") ON DELETE CASCADE,
  "due_on" date NOT NULL,
  "status" "tax_deadline_status" DEFAULT 'OPEN' NOT NULL,
  "filed_on" date,
  "reference" varchar(120),
  "note" varchar(1000),
  "filed_by" uuid,
  "reminded_days" integer,
  "reminded_on" date,
  "created_at" timestamptz(6) DEFAULT now() NOT NULL,
  CONSTRAINT "tax_deadlines_once_per_day" UNIQUE ("obligation_id", "due_on")
);
CREATE INDEX "tax_deadlines_due_idx" ON "tax_deadlines" ("status", "due_on");
