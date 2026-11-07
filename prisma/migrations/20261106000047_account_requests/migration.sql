ALTER TYPE "code_purpose" ADD VALUE 'EMAIL_CHANGE';

ALTER TYPE "support_case_kind" ADD VALUE 'ACCOUNT_CLOSURE';
ALTER TYPE "support_case_kind" ADD VALUE 'DATA_COPY';

ALTER TABLE "users" ADD COLUMN "pending_email" VARCHAR(254);

ALTER TABLE "fulfilment_partners" ADD COLUMN "profile_change" JSONB;
ALTER TABLE "fulfilment_partners" ADD COLUMN "profile_change_at" TIMESTAMPTZ(6);
