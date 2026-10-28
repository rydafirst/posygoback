CREATE TYPE "identity_check_status" AS ENUM ('PENDING', 'IN_REVIEW', 'APPROVED', 'DECLINED', 'ABANDONED', 'EXPIRED');
CREATE TYPE "identity_subject_type" AS ENUM ('VENDOR', 'PARTNER');

CREATE TABLE "identity_checks" (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "subject_type" "identity_subject_type" NOT NULL,
  "subject_id" uuid NOT NULL,
  "provider" varchar(32) NOT NULL,
  "session_id" varchar(120) NOT NULL,
  "status" "identity_check_status" DEFAULT 'PENDING' NOT NULL,
  "document_type" varchar(60),
  "issuing_country" varchar(3),
  "document_expiry" date,
  "name_matches" boolean,
  "reason" varchar(300),
  "decided_at" timestamptz(6),
  "superseded_at" timestamptz(6),
  "created_at" timestamptz(6) DEFAULT now() NOT NULL,
  "updated_at" timestamptz(6) DEFAULT now() NOT NULL,
  CONSTRAINT "identity_checks_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "identity_checks_session_unique" ON "identity_checks" ("provider", "session_id");
CREATE INDEX "identity_checks_subject_idx" ON "identity_checks" ("subject_type", "subject_id", "created_at");

CREATE TABLE "identity_webhook_events" (
  "provider" varchar(32) NOT NULL,
  "event_id" varchar(120) NOT NULL,
  "received_at" timestamptz(6) DEFAULT now() NOT NULL,
  CONSTRAINT "identity_webhook_events_pkey" PRIMARY KEY ("provider", "event_id")
);
CREATE INDEX "identity_webhook_events_received_idx" ON "identity_webhook_events" ("received_at");
