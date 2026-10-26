CREATE TYPE "public"."invitation_status" AS ENUM('PENDING', 'ACCEPTED', 'REVOKED', 'EXPIRED');
CREATE TYPE "public"."legal_document_kind" AS ENUM('VENDOR_AGREEMENT', 'TERMS', 'PRIVACY');
CREATE TYPE "public"."verification_status" AS ENUM('NOT_STARTED', 'IN_PROGRESS', 'SUBMITTED', 'APPROVED', 'REJECTED', 'RESUBMISSION_REQUIRED');
CREATE TABLE "agreement_acceptances" (
	"vendor_id" uuid NOT NULL,
	"legal_document_id" uuid NOT NULL,
	"accepted_by" uuid NOT NULL,
	"accepted_at" timestamp with time zone DEFAULT now() NOT NULL,
	"ip" varchar(64),
	"user_agent" varchar(512),
	CONSTRAINT "agreement_acceptances_vendor_id_legal_document_id_pk" PRIMARY KEY("vendor_id","legal_document_id")
);

CREATE TABLE "legal_documents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"country_code" char(2) NOT NULL,
	"kind" "legal_document_kind" NOT NULL,
	"version" varchar(32) NOT NULL,
	"title" varchar(160) NOT NULL,
	"body" text NOT NULL,
	"published_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid
);

CREATE TABLE "vendor_destinations" (
	"vendor_id" uuid NOT NULL,
	"country_code" char(2) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "vendor_destinations_vendor_id_country_code_pk" PRIMARY KEY("vendor_id","country_code")
);

CREATE TABLE "vendor_invitations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"vendor_id" uuid NOT NULL,
	"email" varchar(254) NOT NULL,
	"token_hash" char(64) NOT NULL,
	"status" "invitation_status" DEFAULT 'PENDING' NOT NULL,
	"invited_by" uuid NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"accepted_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "vendor_invitations_token_hash_unique" UNIQUE("token_hash"),
	CONSTRAINT "vendor_invitations_email_lowercase" CHECK ("vendor_invitations"."email" = lower("vendor_invitations"."email"))
);

CREATE TABLE "vendor_verifications" (
	"vendor_id" uuid PRIMARY KEY NOT NULL,
	"country_code" char(2) NOT NULL,
	"status" "verification_status" DEFAULT 'NOT_STARTED' NOT NULL,
	"answers_encrypted" text,
	"id_number_encrypted" text,
	"id_number_last4" varchar(4),
	"provider" varchar(32),
	"provider_reference" varchar(120),
	"submitted_at" timestamp with time zone,
	"decided_at" timestamp with time zone,
	"decided_by" uuid,
	"decision_reason" varchar(1000),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

ALTER TABLE "agreement_acceptances" ADD CONSTRAINT "agreement_acceptances_vendor_id_vendors_id_fk" FOREIGN KEY ("vendor_id") REFERENCES "public"."vendors"("id") ON DELETE restrict ON UPDATE no action;
ALTER TABLE "agreement_acceptances" ADD CONSTRAINT "agreement_acceptances_legal_document_id_legal_documents_id_fk" FOREIGN KEY ("legal_document_id") REFERENCES "public"."legal_documents"("id") ON DELETE restrict ON UPDATE no action;
ALTER TABLE "agreement_acceptances" ADD CONSTRAINT "agreement_acceptances_accepted_by_users_id_fk" FOREIGN KEY ("accepted_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;
ALTER TABLE "legal_documents" ADD CONSTRAINT "legal_documents_country_code_countries_code_fk" FOREIGN KEY ("country_code") REFERENCES "public"."countries"("code") ON DELETE restrict ON UPDATE no action;
ALTER TABLE "legal_documents" ADD CONSTRAINT "legal_documents_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;
ALTER TABLE "vendor_destinations" ADD CONSTRAINT "vendor_destinations_vendor_id_vendors_id_fk" FOREIGN KEY ("vendor_id") REFERENCES "public"."vendors"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "vendor_destinations" ADD CONSTRAINT "vendor_destinations_country_code_countries_code_fk" FOREIGN KEY ("country_code") REFERENCES "public"."countries"("code") ON DELETE restrict ON UPDATE no action;
ALTER TABLE "vendor_invitations" ADD CONSTRAINT "vendor_invitations_vendor_id_vendors_id_fk" FOREIGN KEY ("vendor_id") REFERENCES "public"."vendors"("id") ON DELETE restrict ON UPDATE no action;
ALTER TABLE "vendor_invitations" ADD CONSTRAINT "vendor_invitations_invited_by_users_id_fk" FOREIGN KEY ("invited_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;
ALTER TABLE "vendor_verifications" ADD CONSTRAINT "vendor_verifications_vendor_id_vendors_id_fk" FOREIGN KEY ("vendor_id") REFERENCES "public"."vendors"("id") ON DELETE restrict ON UPDATE no action;
ALTER TABLE "vendor_verifications" ADD CONSTRAINT "vendor_verifications_country_code_countries_code_fk" FOREIGN KEY ("country_code") REFERENCES "public"."countries"("code") ON DELETE restrict ON UPDATE no action;
ALTER TABLE "vendor_verifications" ADD CONSTRAINT "vendor_verifications_decided_by_users_id_fk" FOREIGN KEY ("decided_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;
CREATE UNIQUE INDEX "legal_documents_version_unique" ON "legal_documents" USING btree ("country_code","kind","version");
CREATE INDEX "legal_documents_latest_idx" ON "legal_documents" USING btree ("country_code","kind","published_at");
CREATE INDEX "vendor_invitations_vendor_status_idx" ON "vendor_invitations" USING btree ("vendor_id","status");
CREATE UNIQUE INDEX "vendor_invitations_one_pending_per_email" ON "vendor_invitations" USING btree ("vendor_id","email") WHERE "vendor_invitations"."status" = 'PENDING';
CREATE INDEX "vendor_verifications_country_status_idx" ON "vendor_verifications" USING btree ("country_code","status","submitted_at");