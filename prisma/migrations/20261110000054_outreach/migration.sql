CREATE TYPE "OutreachKind" AS ENUM ('PREP_CENTRE', 'CARGO_AGENT', 'COURIER', 'INDIVIDUAL', 'OTHER');
CREATE TYPE "OutreachStatus" AS ENUM ('NOT_CONTACTED', 'MESSAGED', 'REPLIED', 'CALL_BOOKED', 'ONBOARDED', 'DECLINED', 'UNSUBSCRIBED');
CREATE TYPE "OutreachMessageStatus" AS ENUM ('SENT', 'FAILED');

CREATE TABLE "outreach_contacts" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "business" varchar(120) NOT NULL,
  "contact_name" varchar(120),
  "email" varchar(254),
  "phone" varchar(40),
  "website" varchar(300),
  "country" varchar(60) NOT NULL,
  "city" varchar(80),
  "kind" "OutreachKind" NOT NULL,
  "status" "OutreachStatus" DEFAULT 'NOT_CONTACTED' NOT NULL,
  "notes" varchar(1000),
  "source" varchar(300),
  "last_messaged_at" timestamp with time zone,
  "created_by" uuid NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
CREATE UNIQUE INDEX "outreach_contacts_email_unique" ON "outreach_contacts" (lower("email")) WHERE "email" IS NOT NULL;
CREATE INDEX "outreach_contacts_status_idx" ON "outreach_contacts" ("status", "country");
ALTER TABLE "outreach_contacts" ADD CONSTRAINT "outreach_contacts_created_by_fk" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;

CREATE TABLE "outreach_messages" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "contact_id" uuid NOT NULL,
  "subject" varchar(150) NOT NULL,
  "body" text NOT NULL,
  "status" "OutreachMessageStatus" NOT NULL,
  "provider_id" varchar(100),
  "error" varchar(300),
  "sent_by" uuid NOT NULL,
  "sent_at" timestamp with time zone DEFAULT now() NOT NULL
);
CREATE INDEX "outreach_messages_contact_idx" ON "outreach_messages" ("contact_id", "sent_at");
CREATE INDEX "outreach_messages_sent_idx" ON "outreach_messages" ("sent_at");
ALTER TABLE "outreach_messages" ADD CONSTRAINT "outreach_messages_contact_fk" FOREIGN KEY ("contact_id") REFERENCES "outreach_contacts"("id") ON DELETE CASCADE ON UPDATE NO ACTION;
ALTER TABLE "outreach_messages" ADD CONSTRAINT "outreach_messages_sent_by_fk" FOREIGN KEY ("sent_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;
