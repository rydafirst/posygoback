CREATE UNIQUE INDEX "partner_payouts_one_open" ON "partner_payouts" ("partner_id") WHERE "status" IN ('PENDING_APPROVAL', 'PROCESSING');
