CREATE TYPE "payment_mode" AS ENUM ('TEST', 'LIVE');

ALTER TABLE "partner_payout_accounts" ADD COLUMN "mode" "payment_mode" NOT NULL DEFAULT 'TEST';
ALTER TABLE "vendor_payout_accounts" ADD COLUMN "mode" "payment_mode" NOT NULL DEFAULT 'TEST';
