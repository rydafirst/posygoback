CREATE TABLE "partner_adjustments" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "partner_id" uuid NOT NULL,
  "currency" char(3) NOT NULL,
  "direction" "adjustment_direction" NOT NULL,
  "amount_minor" bigint NOT NULL,
  "reason" varchar(300) NOT NULL,
  "reference" varchar(120),
  "status" "adjustment_status" DEFAULT 'PENDING_APPROVAL' NOT NULL,
  "requested_by" uuid NOT NULL,
  "decided_by" uuid,
  "decision_note" varchar(300),
  "ledger_entry_id" uuid,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "decided_at" timestamp with time zone,
  CONSTRAINT "partner_adjustments_amount_positive" CHECK ("amount_minor" > 0),
  CONSTRAINT "partner_adjustments_maker_checker" CHECK ("decided_by" IS NULL OR "decided_by" <> "requested_by")
);
CREATE UNIQUE INDEX "partner_adjustments_ledger_entry_unique" ON "partner_adjustments" ("ledger_entry_id");
CREATE INDEX "partner_adjustments_status_idx" ON "partner_adjustments" ("status", "created_at");
CREATE INDEX "partner_adjustments_partner_idx" ON "partner_adjustments" ("partner_id", "created_at");
ALTER TABLE "partner_adjustments" ADD CONSTRAINT "partner_adjustments_partner_fk" FOREIGN KEY ("partner_id") REFERENCES "fulfilment_partners"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;
ALTER TABLE "partner_adjustments" ADD CONSTRAINT "partner_adjustments_requested_by_users_id_fk" FOREIGN KEY ("requested_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;
ALTER TABLE "partner_adjustments" ADD CONSTRAINT "partner_adjustments_decided_by_users_id_fk" FOREIGN KEY ("decided_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;
ALTER TABLE "partner_adjustments" ADD CONSTRAINT "partner_adjustments_ledger_entry_fk" FOREIGN KEY ("ledger_entry_id") REFERENCES "partner_ledger_entries"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;
