ALTER TABLE "agreement_acceptances"
  ADD COLUMN "signature_name" varchar(160),
  ADD COLUMN "signature_method" varchar(10),
  ADD COLUMN "signature_image" text,
  ADD COLUMN "document_sha256" char(64),
  ADD COLUMN "reference" varchar(24);
CREATE UNIQUE INDEX "agreement_acceptances_reference_unique" ON "agreement_acceptances" ("reference");
ALTER TABLE "agreement_acceptances" ADD CONSTRAINT "agreement_acceptances_signature_method_check" CHECK ("signature_method" IN ('DRAWN', 'TYPED'));

ALTER TABLE "partner_agreement_acceptances"
  ADD COLUMN "signature_method" varchar(10),
  ADD COLUMN "signature_image" text,
  ADD COLUMN "reference" varchar(24);
CREATE UNIQUE INDEX "partner_agreement_acceptances_reference_unique" ON "partner_agreement_acceptances" ("reference");
ALTER TABLE "partner_agreement_acceptances" ADD CONSTRAINT "partner_agreement_acceptances_signature_method_check" CHECK ("signature_method" IN ('DRAWN', 'TYPED'));
