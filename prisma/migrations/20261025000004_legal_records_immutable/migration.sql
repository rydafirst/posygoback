CREATE TRIGGER legal_documents_immutable
BEFORE UPDATE OR DELETE ON legal_documents
FOR EACH ROW EXECUTE FUNCTION reject_mutation();

CREATE TRIGGER agreement_acceptances_immutable
BEFORE UPDATE OR DELETE ON agreement_acceptances
FOR EACH ROW EXECUTE FUNCTION reject_mutation();
