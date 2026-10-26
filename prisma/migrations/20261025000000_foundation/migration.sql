CREATE TYPE "public"."code_purpose" AS ENUM('EMAIL_VERIFICATION', 'PASSWORD_RESET');
CREATE TYPE "public"."country_status" AS ENUM('PROSPECTIVE', 'ONBOARDING', 'LIVE', 'SUSPENDED', 'CLOSED');
CREATE TYPE "public"."file_purpose" AS ENUM('KYC_DOCUMENT', 'EVIDENCE_PHOTO', 'LABEL_DOCUMENT', 'GENERAL_ATTACHMENT');
CREATE TYPE "public"."file_status" AS ENUM('PENDING_UPLOAD', 'VERIFIED', 'REJECTED');
CREATE TYPE "public"."mfa_state" AS ENUM('VERIFIED', 'NOT_REQUIRED', 'ENROLMENT_REQUIRED');
CREATE TYPE "public"."role" AS ENUM('VENDOR_OWNER', 'VENDOR_MEMBER', 'WAREHOUSE_OPERATOR', 'FULFILMENT_PARTNER', 'PARTNER_STAFF', 'COUNTRY_OPS', 'FINANCE_ADMIN', 'COMPLIANCE', 'ADMIN', 'SUPER_ADMIN');
CREATE TYPE "public"."user_status" AS ENUM('PENDING_EMAIL_VERIFICATION', 'ACTIVE', 'SUSPENDED', 'CLOSED');
CREATE TYPE "public"."vendor_status" AS ENUM('PENDING_VERIFICATION', 'ACTIVE', 'SUSPENDED', 'CLOSED');
CREATE TABLE "countries" (
	"code" char(2) PRIMARY KEY NOT NULL,
	"name" varchar(80) NOT NULL,
	"currency" char(3) NOT NULL,
	"status" "country_status" DEFAULT 'PROSPECTIVE' NOT NULL,
	"config" jsonb NOT NULL,
	"status_reason" varchar(500),
	"status_changed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "countries_code_format" CHECK ("countries"."code" ~ '^[A-Z]{2}$'),
	CONSTRAINT "countries_currency_format" CHECK ("countries"."currency" ~ '^[A-Z]{3}$')
);

CREATE TABLE "shipping_lanes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"origin_country_code" char(2) NOT NULL,
	"destination_country_code" char(2) NOT NULL,
	"enabled" boolean DEFAULT false NOT NULL,
	"customs_required" boolean NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "shipping_lanes_domestic_no_customs" CHECK ("shipping_lanes"."origin_country_code" <> "shipping_lanes"."destination_country_code" OR "shipping_lanes"."customs_required" = false)
);

CREATE TABLE "recovery_codes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"code_hash" char(64) NOT NULL,
	"used_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE "sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"refresh_token_hash" char(64) NOT NULL,
	"previous_token_hashes" text[] DEFAULT '{}'::text[] NOT NULL,
	"mfa_state" "mfa_state" NOT NULL,
	"ip" varchar(64),
	"user_agent" varchar(512),
	"expires_at" timestamp with time zone NOT NULL,
	"revoked_at" timestamp with time zone,
	"revoked_reason" varchar(64),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_used_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sessions_refresh_token_hash_unique" UNIQUE("refresh_token_hash")
);

CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" varchar(254) NOT NULL,
	"password_hash" text NOT NULL,
	"role" "role" NOT NULL,
	"status" "user_status" DEFAULT 'PENDING_EMAIL_VERIFICATION' NOT NULL,
	"vendor_id" uuid,
	"country_code" char(2),
	"email_verified_at" timestamp with time zone,
	"mfa_secret_encrypted" text,
	"mfa_pending_secret_encrypted" text,
	"mfa_enrolled_at" timestamp with time zone,
	"failed_login_count" integer DEFAULT 0 NOT NULL,
	"locked_until" timestamp with time zone,
	"password_changed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "users_email_unique" UNIQUE("email"),
	CONSTRAINT "users_email_lowercase" CHECK ("users"."email" = lower("users"."email")),
	CONSTRAINT "users_vendor_roles_have_vendor" CHECK (("users"."role" IN ('VENDOR_OWNER','VENDOR_MEMBER')) = ("users"."vendor_id" IS NOT NULL)),
	CONSTRAINT "users_failed_login_non_negative" CHECK ("users"."failed_login_count" >= 0)
);

CREATE TABLE "vendors" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"business_name" varchar(120) NOT NULL,
	"country_code" char(2) NOT NULL,
	"status" "vendor_status" DEFAULT 'PENDING_VERIFICATION' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE "verification_codes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"purpose" "code_purpose" NOT NULL,
	"code_hash" char(64) NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"consumed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "verification_codes_code_hash_unique" UNIQUE("code_hash")
);

CREATE TABLE "audit_log_entries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"sequence" bigserial NOT NULL,
	"actor_id" uuid,
	"actor_role" "role",
	"country_code" char(2),
	"vendor_id" uuid,
	"action" varchar(120) NOT NULL,
	"resource_type" varchar(60) NOT NULL,
	"resource_id" varchar(120),
	"before_state" jsonb,
	"after_state" jsonb,
	"ip" varchar(64),
	"user_agent" varchar(512),
	"correlation_id" varchar(64),
	"prev_hash" char(64) DEFAULT '' NOT NULL,
	"hash" char(64) DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "audit_log_entries_sequence_unique" UNIQUE("sequence")
);

CREATE TABLE "stored_files" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"object_key" varchar(300) NOT NULL,
	"purpose" "file_purpose" NOT NULL,
	"status" "file_status" DEFAULT 'PENDING_UPLOAD' NOT NULL,
	"owner_user_id" uuid NOT NULL,
	"vendor_id" uuid,
	"country_code" char(2),
	"declared_mime" varchar(100) NOT NULL,
	"detected_mime" varchar(100),
	"max_bytes" integer NOT NULL,
	"size_bytes" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"verified_at" timestamp with time zone,
	CONSTRAINT "stored_files_object_key_unique" UNIQUE("object_key"),
	CONSTRAINT "stored_files_max_bytes_positive" CHECK ("stored_files"."max_bytes" > 0)
);

ALTER TABLE "shipping_lanes" ADD CONSTRAINT "shipping_lanes_origin_country_code_countries_code_fk" FOREIGN KEY ("origin_country_code") REFERENCES "public"."countries"("code") ON DELETE restrict ON UPDATE no action;
ALTER TABLE "shipping_lanes" ADD CONSTRAINT "shipping_lanes_destination_country_code_countries_code_fk" FOREIGN KEY ("destination_country_code") REFERENCES "public"."countries"("code") ON DELETE restrict ON UPDATE no action;
ALTER TABLE "recovery_codes" ADD CONSTRAINT "recovery_codes_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "users" ADD CONSTRAINT "users_vendor_id_vendors_id_fk" FOREIGN KEY ("vendor_id") REFERENCES "public"."vendors"("id") ON DELETE restrict ON UPDATE no action;
ALTER TABLE "users" ADD CONSTRAINT "users_country_code_countries_code_fk" FOREIGN KEY ("country_code") REFERENCES "public"."countries"("code") ON DELETE restrict ON UPDATE no action;
ALTER TABLE "vendors" ADD CONSTRAINT "vendors_country_code_countries_code_fk" FOREIGN KEY ("country_code") REFERENCES "public"."countries"("code") ON DELETE restrict ON UPDATE no action;
ALTER TABLE "verification_codes" ADD CONSTRAINT "verification_codes_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "stored_files" ADD CONSTRAINT "stored_files_owner_user_id_users_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;
ALTER TABLE "stored_files" ADD CONSTRAINT "stored_files_vendor_id_vendors_id_fk" FOREIGN KEY ("vendor_id") REFERENCES "public"."vendors"("id") ON DELETE restrict ON UPDATE no action;
CREATE INDEX "countries_status_idx" ON "countries" USING btree ("status");
CREATE UNIQUE INDEX "shipping_lanes_route_unique" ON "shipping_lanes" USING btree ("origin_country_code","destination_country_code");
CREATE INDEX "shipping_lanes_origin_enabled_idx" ON "shipping_lanes" USING btree ("origin_country_code","enabled");
CREATE INDEX "recovery_codes_user_used_idx" ON "recovery_codes" USING btree ("user_id","used_at");
CREATE INDEX "sessions_user_revoked_idx" ON "sessions" USING btree ("user_id","revoked_at");
CREATE INDEX "sessions_expires_idx" ON "sessions" USING btree ("expires_at");
CREATE INDEX "users_vendor_idx" ON "users" USING btree ("vendor_id");
CREATE INDEX "users_role_status_idx" ON "users" USING btree ("role","status");
CREATE INDEX "vendors_country_status_idx" ON "vendors" USING btree ("country_code","status");
CREATE INDEX "verification_codes_user_purpose_idx" ON "verification_codes" USING btree ("user_id","purpose","consumed_at");
CREATE INDEX "audit_actor_created_idx" ON "audit_log_entries" USING btree ("actor_id","created_at");
CREATE INDEX "audit_resource_idx" ON "audit_log_entries" USING btree ("resource_type","resource_id");
CREATE INDEX "audit_country_created_idx" ON "audit_log_entries" USING btree ("country_code","created_at");
CREATE INDEX "stored_files_owner_created_idx" ON "stored_files" USING btree ("owner_user_id","created_at");
CREATE INDEX "stored_files_vendor_purpose_idx" ON "stored_files" USING btree ("vendor_id","purpose");