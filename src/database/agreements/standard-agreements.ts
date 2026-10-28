import type { LegalDocumentKind } from "../../shared";
import { legalProfileFor } from "./legal-profiles";
import { PARTNER_AGREEMENT_TITLE, partnerAgreementBody } from "./partner-agreement";
import { PRIVACY_TITLE, privacyPolicyBody } from "./privacy-policy";
import { TERMS_TITLE, termsOfServiceBody } from "./terms-of-service";
import { VENDOR_AGREEMENT_TITLE, vendorAgreementBody } from "./vendor-agreement";

export const STANDARD_AGREEMENT_VERSION = "2026.10";

export interface StandardAgreement {
  countryCode: string;
  kind: LegalDocumentKind;
  version: string;
  title: string;
  body: string;
}

export function standardAgreementsFor(countryCode: string): StandardAgreement[] {
  const profile = legalProfileFor(countryCode);
  if (!profile) {
    return [];
  }
  return [
    { countryCode, kind: "VENDOR_AGREEMENT", version: STANDARD_AGREEMENT_VERSION, title: VENDOR_AGREEMENT_TITLE, body: vendorAgreementBody(profile) },
    { countryCode, kind: "PARTNER_AGREEMENT", version: STANDARD_AGREEMENT_VERSION, title: PARTNER_AGREEMENT_TITLE, body: partnerAgreementBody(profile) },
    { countryCode, kind: "TERMS", version: STANDARD_AGREEMENT_VERSION, title: TERMS_TITLE, body: termsOfServiceBody(profile) },
    { countryCode, kind: "PRIVACY", version: STANDARD_AGREEMENT_VERSION, title: PRIVACY_TITLE, body: privacyPolicyBody(profile) },
  ];
}
