ALTER TABLE "vendors" ADD COLUMN "deactivated_at" TIMESTAMPTZ(6), ADD COLUMN "status_before_deactivation" "vendor_status";
ALTER TABLE "fulfilment_partners" ADD COLUMN "deactivated_at" TIMESTAMPTZ(6), ADD COLUMN "status_before_deactivation" "partner_status";

CREATE OR REPLACE FUNCTION reject_mutation_unless_removing_account()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'DELETE' AND current_setting('app.removing_account', true) = 'on' THEN
    RETURN OLD;
  END IF;
  RAISE EXCEPTION '% is append-only', TG_TABLE_NAME USING ERRCODE = 'insufficient_privilege';
END;
$$;

DROP TRIGGER "wallets_no_delete" ON "wallets";
CREATE TRIGGER "wallets_no_delete" BEFORE DELETE ON "wallets" FOR EACH ROW EXECUTE FUNCTION reject_mutation_unless_removing_account();

DROP TRIGGER "fulfilment_partners_no_delete" ON "fulfilment_partners";
CREATE TRIGGER "fulfilment_partners_no_delete" BEFORE DELETE ON "fulfilment_partners" FOR EACH ROW EXECUTE FUNCTION reject_mutation_unless_removing_account();

DROP TRIGGER agreement_acceptances_immutable ON agreement_acceptances;
CREATE TRIGGER agreement_acceptances_immutable BEFORE UPDATE OR DELETE ON agreement_acceptances FOR EACH ROW EXECUTE FUNCTION reject_mutation_unless_removing_account();

DROP TRIGGER "partner_agreement_acceptances_immutable" ON "partner_agreement_acceptances";
CREATE TRIGGER "partner_agreement_acceptances_immutable" BEFORE UPDATE OR DELETE ON "partner_agreement_acceptances" FOR EACH ROW EXECUTE FUNCTION reject_mutation_unless_removing_account();
