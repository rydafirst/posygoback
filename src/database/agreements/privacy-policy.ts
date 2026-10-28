import { LegalProfile } from "./legal-profiles";

export const PRIVACY_TITLE = "Privacy Policy";

const UK_CODE = "GB";

const EU_GDPR_CODES: ReadonlySet<string> = new Set(["IE", "DE", "FR", "NL", "ES", "IT"]);

const REGULATORS: Readonly<Record<string, string>> = {
  GB: "the Information Commissioner's Office (ICO)",
  IE: "the Data Protection Commission",
  FR: "the Commission Nationale de l'Informatique et des Libertés (CNIL)",
  NL: "the Dutch Data Protection Authority (Autoriteit Persoonsgegevens)",
  ES: "the Spanish Data Protection Agency (Agencia Española de Protección de Datos)",
  IT: "the Italian Data Protection Authority (Garante per la protezione dei dati personali)",
  US: "the privacy or consumer protection regulator in your state, or the Federal Trade Commission",
  CA: "the Office of the Privacy Commissioner of Canada",
  BR: "the National Data Protection Authority (Autoridade Nacional de Proteção de Dados, ANPD)",
  AU: "the Office of the Australian Information Commissioner (OAIC)",
  NZ: "the Office of the Privacy Commissioner",
  SG: "the Personal Data Protection Commission (PDPC)",
  JP: "the Personal Information Protection Commission",
  NG: "the Nigeria Data Protection Commission (NDPC)",
  GH: "the Data Protection Commission",
  KE: "the Office of the Data Protection Commissioner",
  ZA: "the Information Regulator",
};

interface Purpose {
  use: string;
  basis: string;
}

const PURPOSES: readonly Purpose[] = [
  {
    use: "To create and run your account, let you sign in and provide the Platform.",
    basis: "performing our contract with you, or taking steps at your request before entering into one.",
  },
  {
    use: "To verify sellers and their contact person, and to assess fulfilment partner applications, including contacting referees.",
    basis: "our legitimate interests in keeping the Platform safe, preventing fraud and protecting the stock we hold, and your explicit consent for the biometric comparison described in section 5.",
  },
  {
    use: "To record your signature when you accept an agreement on the Platform.",
    basis: "performing our contract with you, and our legitimate interest in being able to show what was agreed.",
  },
  {
    use: "To process the activation fee and wallet top-ups, and to pay fulfilment partners.",
    basis: "performing our contract with you, and complying with our legal obligations to keep financial records.",
  },
  {
    use: "To receive and store stock, fulfil orders, process returns and handle claims.",
    basis: "performing our contract with the seller. For Recipient data, we act on the seller's instructions as section 2.2 explains.",
  },
  {
    use: "To manage the work of fulfilment partners through custody records, stock counts, test orders and scorecards.",
    basis: "performing our contract with you, and our legitimate interests in protecting sellers' stock and keeping service quality high.",
  },
  {
    use: "To meet tax and right-to-work requirements, including holding fulfilment partners' tax details and declarations.",
    basis: "complying with our legal obligations.",
  },
  {
    use: "To send service emails, such as verification updates, sign-in alerts, notices and replies to support requests.",
    basis: "performing our contract with you, and our legitimate interest in keeping you informed about your account.",
  },
  {
    use: "To answer questions through Posy and to handle support cases and error records.",
    basis: "our legitimate interests in helping you and fixing problems with the Platform.",
  },
  {
    use: "To improve the Platform, using Posy logs, support cases and error records.",
    basis: "our legitimate interest in making our service work better.",
  },
  {
    use: "To keep accounts and the Platform secure, including two-factor sign-in, sign-in alerts and audit logs.",
    basis: "our legitimate interests in security and preventing fraud, and our legal obligation to keep personal data secure.",
  },
  {
    use: "To save drafts of forms so that you do not have to start again.",
    basis: "our legitimate interest in making the Platform easier to use.",
  },
  {
    use: "To keep business and financial records, comply with the law and respond to lawful requests from authorities.",
    basis: "complying with our legal obligations.",
  },
  {
    use: "To establish, exercise or defend legal claims, and to enforce our terms and agreements.",
    basis: "our legitimate interests in protecting our business and the people who use the Platform.",
  },
];

function usesGdpr(profile: LegalProfile): boolean {
  return profile.code === UK_CODE || EU_GDPR_CODES.has(profile.code);
}

function regulatorFor(profile: LegalProfile): string {
  return REGULATORS[profile.code] ?? `the data protection authority in ${profile.name}`;
}

function biometricClause(profile: LegalProfile): string {
  if (usesGdpr(profile)) {
    return `5.5 The comparison of your selfie with your identity document uses biometric data, which is special category data under ${profile.dataProtection}. We rely on your explicit consent for it, which you give when you start the check. Our wider verification of sellers and fulfilment partners relies on our legitimate interests in keeping the Platform safe and protecting the stock we hold, and, where they apply, on our legal obligations.`;
  }
  return `5.5 The comparison of your selfie with your identity document uses biometric information, which may be treated as sensitive under ${profile.dataProtection}. We only carry out the check with your consent, which you give when you start it.`;
}

function usesSection(profile: LegalProfile): string {
  if (usesGdpr(profile)) {
    const lines = PURPOSES.map(({ use, basis }) => `- ${use} Legal basis: ${basis}`).join("\n");
    return `## 7. How we use personal data and our legal bases

7.1 Under ${profile.dataProtection}, we must have a legal basis for each way we use personal data. The legal bases we rely on are performing a contract, complying with a legal obligation, our legitimate interests and, for the biometric comparison, your explicit consent.

7.2 We use personal data for these purposes, on the legal bases shown:
${lines}

7.3 Where we rely on our legitimate interests, we have balanced them against your interests and rights, and you can object as section 13 explains. Where we rely on your consent, you can withdraw it at any time. This does not affect anything we did before you withdrew it.

7.4 If you do not give us information we need to enter into a contract with you or to meet a legal obligation, we may not be able to open your account or provide our services.

7.5 We do not use personal data for advertising, and we do not sell it.`;
  }

  const lines = PURPOSES.map(({ use }) => `- ${use}`).join("\n");
  return `## 7. How we use personal data

7.1 We use personal data for these purposes:
${lines}

7.2 We collect and use personal data only for the purposes described in this policy, which we tell you about when we collect it or before. Where your consent is required under ${profile.dataProtection}, we ask for it, and you can withdraw it at any time, although we may then be unable to provide some services. Where the law allows us to rely on other grounds, such as performing a contract with you, complying with a legal obligation or our legitimate business purposes, we do so.

7.3 We will not use personal data for a new purpose that is unrelated to those described here without telling you first and, where the law requires it, asking for your consent.

7.4 If you do not give us information we need to provide our services or to meet a legal obligation, we may not be able to open your account or provide those services.

7.5 We do not use personal data for advertising, and we do not sell it.`;
}

function transferSafeguards(profile: LegalProfile): string {
  if (profile.code === UK_CODE) {
    return "UK adequacy regulations, the International Data Transfer Agreement, the UK Addendum to the EU standard contractual clauses, or another safeguard the UK GDPR allows";
  }
  if (EU_GDPR_CODES.has(profile.code)) {
    return "an adequacy decision of the European Commission, the standard contractual clauses approved by the European Commission, or another safeguard the EU General Data Protection Regulation allows";
  }
  return `contractual commitments, such as standard contractual clauses, and any other safeguards required under ${profile.dataProtection}`;
}

function transferClause(profile: LegalProfile): string {
  const region = EU_GDPR_CODES.has(profile.code) ? "the European Economic Area" : profile.name;
  const destination = profile.code === "US" ? "" : ", in countries that may include the United States";
  return `10.1 Some of our service providers process personal data outside ${region}${destination}.`;
}

function rightsList(profile: LegalProfile): string {
  if (usesGdpr(profile)) {
    return `13.1 Under ${profile.dataProtection}, you have the right to:
- ask for access to the personal data we hold about you and for a copy of it;
- ask us to correct personal data that is wrong or incomplete;
- ask us to delete your personal data;
- ask us to restrict how we use your personal data;
- object to our use of your personal data where we rely on our legitimate interests;
- receive personal data you gave us in a structured, commonly used, machine-readable format, and ask us to send it to another organisation;
- withdraw your consent at any time where we rely on it; and
- not be subject to a decision based solely on automated processing that has a legal or similarly significant effect on you, and to ask for a person to review it.

13.2 Some of these rights have conditions and exceptions. For example, we may need to keep certain records to meet a legal obligation even if you ask us to delete them. If we cannot do what you ask, we will tell you why.`;
  }
  return `13.1 Depending on ${profile.dataProtection} and your circumstances, you may have the right to:
- know what personal data we hold about you and get a copy of it;
- ask us to correct personal data that is wrong or incomplete;
- ask us to delete your personal data;
- object to, or ask us to limit, certain uses of your personal data;
- withdraw your consent at any time where we rely on it;
- receive personal data you gave us in a portable format, where the law provides for this; and
- ask for a person to review a decision made solely by automated means.

13.2 Some of these rights have conditions and exceptions. For example, we may need to keep certain records to meet a legal obligation even if you ask us to delete them. If we cannot do what you ask, we will tell you why.`;
}

function complaintClause(profile: LegalProfile): string {
  const regulator = regulatorFor(profile);
  if (EU_GDPR_CODES.has(profile.code)) {
    return `13.5 You have the right to complain to ${regulator}, or to the data protection supervisory authority in the EU country where you live or work or where you believe the problem happened. We would appreciate the chance to deal with your concern first, so please contact us before you complain.`;
  }
  return `13.5 You can complain to ${regulator}. We would appreciate the chance to deal with your concern first, so please contact us before you complain.`;
}

export function privacyPolicyBody(profile: LegalProfile): string {
  const { name, dataProtection } = profile;

  return `## 1. About this policy

1.1 This Privacy Policy explains how Posygo ("Posygo", "we", "us" or "our") collects, uses, shares and protects personal data when you use our website, seller dashboard, partner app, API, public tracking page and partner application form (together, the "Platform").

1.2 Posygo stores a seller's stock in each country the seller chooses to sell in, and picks, packs and delivers each order inside that country. We do not ship goods from one country to another.

1.3 This version of the policy is for people in ${name}. It explains how we meet ${dataProtection}, and the rights you have under it. In this policy, "personal data" means any information about an identified or identifiable person, and includes what the law in ${name} may call personal information.

1.4 This policy is the privacy notice referred to in our Fulfilment Services Agreement and our Fulfilment Partner Agreement.

## 2. Who we are and our roles

2.1 Posygo is the controller of the personal data we hold about website visitors, sellers and their team members, fulfilment partners and their referees, people who contact support, and our own staff when they use the Platform. This means we decide how and why that data is used.

2.2 When a seller gives us the details of its customers so that we can deliver their orders ("Recipients"), the seller is the controller of that data and we are its processor. We use Recipient data only on the seller's instructions under the Fulfilment Services Agreement, and only to deliver orders, process returns, handle claims and support the seller. If you are a Recipient, the seller you bought from is responsible for telling you how it uses your data, and you should contact it first about your rights. If you contact us, we will pass your request to the seller and help it respond.

2.3 You can contact us about this policy or your personal data through the support channel in your account, or by email to the address published on our website.

## 3. The personal data we collect

3.1 Website visitors. If you only browse our public pages, we collect very little. We use the strictly necessary cookies and browser storage described in section 14. If you use the public tracking page, we use the tracking number you enter to show you the delivery status. Our hosting providers process technical data, such as your IP address, to deliver pages to you and protect the Platform from abuse.

3.2 Sellers and their team members. We collect:
- sign-up details: business name, email address and password, and the countries you choose to store stock in;
- team member details: the name and email address of each person invited to the account;
- verification details: company details, the name and contact details of your contact person, the business document you upload, and the result of the contact person's identity check as section 5 describes;
- signing records: the name entered to sign an agreement, the account and email address, the IP address, the date and time, the version of the agreement and a fingerprint of the text shown;
- payment details: records of the activation fee, wallet top-ups and fees charged, and the payment status Stripe sends us, but not your card details, which are handled by Stripe and never stored by us;
- stock and order details: inbound shipments, stock levels, orders, returns, claims and the API keys you create;
- Posy, support and error records, as section 8 describes;
- security details: the IP address and device type used to sign in, and audit logs of actions taken in the account;
- the email log: the recipient, subject and delivery status of emails we send you; and
- drafts of forms you have started but not finished.

3.3 Fulfilment partners. We collect:
- application details: your name, contact details and the details of your referee;
- the result of your identity check, carried out by Didit or, as a fallback, by Stripe Identity, as section 5 describes;
- proof of your address;
- photos and video of your storage space;
- your right-to-work and tax declaration, including your tax identification number, which we store encrypted;
- payout details: the status of your Stripe Connect account and of each payout, but not your bank details, which are held by Stripe;
- signing records, as for sellers;
- performance records: stock counts, test order results, scorecards and custody records, which log every movement of stock and include photos of parcels; and
- Posy, support and error records, security details, the email log and drafts, as for sellers.

3.4 Referees. If someone names you as a referee, we hold the name and contact details they give us and your response to our request for a reference.

3.5 Recipients. Orders contain the Recipient's name, delivery address, phone number and email address, together with the items being delivered and the tracking events for the delivery. We use this data only to deliver the order and for the purposes in section 2.2.

3.6 People who contact support. We collect your contact details, your messages and the details of your support case. If a case is reported through Posy, it includes the page, the error and the recent steps you took on the page, as section 8 describes.

3.7 Apart from the biometric comparison in section 5, we do not ask for special category or sensitive data, and we ask you not to send it to us.

## 4. Where we get personal data from

4.1 We get personal data:
- directly from you, when you sign up, verify your business, apply to become a fulfilment partner, use the Platform or contact us;
- from sellers, about their team members and about their customers who receive orders;
- from fulfilment partners, about their referees;
- from Didit and Stripe, which send us the outcome of identity checks and the status of payments and payouts; and
- from delivery carriers, which send us tracking events for each delivery.

## 5. The identity check

5.1 We ask the contact person of each seller, and each fulfilment partner, to complete an identity check. Sellers' contact persons complete it with Didit. Fulfilment partners complete it with Didit or, as a fallback, with Stripe Identity.

5.2 The check asks you to take a photo of your identity document and a live selfie. Didit, or Stripe Identity, uses biometric comparison to check that the selfie matches the photo on the document.

5.3 We keep only the outcome of the check, the type of document, the issuing country, the expiry date and whether the name on the document matches the name you gave us. We do not store the images of your identity document or your selfie.

5.4 If you cannot complete the check, for example because you do not have a suitable device, because of a disability, or because you do not want your face compared with your document, please contact us through the support channel or by email to the address published on our website, and we will discuss another way to verify your identity.

${biometricClause(profile)}

## 6. Automated decisions

6.1 The identity check is automated. If the name on your document does not match the name you gave us, or the check fails, the check is declined automatically. You can try again, or ask for a person on our team to review the result by contacting us through the support channel.

6.2 Posy drafts answers to questions automatically. It does not make decisions about your account.

6.3 Fulfilment partner scorecards are calculated from records such as stock counts, test orders and custody records. If any decision that has a legal or similarly significant effect on you is made solely by automated means, you can ask for a person to review it, give us your point of view and challenge the decision.

${usesSection(profile)}

## 8. Posy, support cases and error records

8.1 Posy is the helper inside the Platform that answers questions about using Posygo. To draft an answer, your question may be sent to Anthropic, which provides the Claude AI model. Before a question is sent, the page removes numbers that look like card numbers.

8.2 We log each question, the page it was asked from and the outcome, so that we can provide support and improve the answers Posy gives.

8.3 Please do not type card numbers, passwords, identity document numbers or other sensitive information into Posy.

8.4 When something goes wrong, Posy can report a support case for you. The report includes the page, the error and the recent steps you took on the page. It records the labels of the fields you used, not what you typed into them.

8.5 Our systems also record server failures automatically, with a log reference and the signed-in user, so that we can find and fix the problem.

## 9. Who we share personal data with

9.1 We do not sell personal data, and we do not share it with anyone for advertising.

9.2 We use these service providers to run the Platform. They process personal data on our behalf, under contracts that require them to protect it:
- Didit, to carry out identity checks;
- Stripe, to process the activation fee and wallet top-ups, to make fulfilment partner payouts through Stripe Connect, and to carry out fallback identity checks for fulfilment partners through Stripe Identity;
- Shippo, to create shipping labels and get tracking information;
- Resend, to send emails;
- Cloudflare, to store files such as documents and photos on Cloudflare R2;
- Railway, to host our API;
- Vercel, to host our website; and
- Anthropic, to help Posy draft answers to questions.

9.3 Some of these providers, such as Stripe for payments and payouts, also use personal data for their own legal and regulatory obligations, and do so under their own privacy policies.

9.4 We share Recipients' names, addresses, phone numbers and email addresses with Shippo and with the delivery carriers that deliver each order.

9.5 Fulfilment partners who store and handle stock on our behalf see the order details they need to pick, pack and dispatch each order. They must keep this data confidential and use it only for that purpose.

9.6 If we suspect that stock has been lost or taken while in a fulfilment partner's custody, we may share the relevant records, including custody records and verification information, with the affected seller and with the police or other authorities, as the Fulfilment Partner Agreement explains.

9.7 We may share personal data with courts, regulators, tax authorities, the police and other public bodies where the law requires it, or where we reasonably believe it is needed to protect the rights, property or safety of Posygo, the people who use the Platform or others.

9.8 If we sell, transfer or merge all or part of our business, personal data may be transferred to the buyer or new owner, who must use it in line with this policy.

## 10. International transfers

${transferClause(profile)}

10.2 When we transfer personal data in this way, we make sure it is protected by ${transferSafeguards(profile)}.

10.3 This includes Recipient data. As the Fulfilment Services Agreement says, we transfer Recipient data out of the country where the stock is stored only where data protection laws allow it, with the safeguards they require.

10.4 You can ask us for more information about these safeguards through the support channel in your account.

## 11. How long we keep personal data

11.1 We keep personal data only for as long as we need it for the purposes in this policy:
- account details for sellers, team members and fulfilment partners are kept while the account is active, and for a reasonable period after it closes to deal with questions, disputes and legal claims;
- verification details, including identity check results and business documents, are kept for the same period, and we never store identity document images or selfies;
- proof of address is deleted automatically after the retention period we set, which is 90 days by default;
- financial and ledger records, including fees, wallet top-ups, earnings and payouts, are kept for as long as tax law requires, which is typically six to seven years;
- fulfilment partners' tax details and right-to-work declarations are kept for as long as tax and employment law requires;
- signed agreements and signing records are kept while the agreement is in force and afterwards for as long as the law requires or any dispute needs;
- custody records, stock counts, test order results and scorecards are kept while the agreement is in force and for as long afterwards as we need them to deal with claims and disputes;
- Recipient data is kept for as long as the seller needs us to deliver orders, process returns and handle claims;
- drafts saved to an account are deleted after 30 days, and drafts of the public partner application stay in your browser until you submit the application or clear your browser storage;
- Posy logs, support cases, error records and the email log are kept for a reasonable period to provide support and improve the Platform; and
- audit logs are kept for as long as we need them to protect accounts and investigate security incidents, in a tamper-evident form so that they cannot be changed without detection.

11.2 When an account is closed, we delete or anonymise its personal data after the reasonable period in section 11.1, except for records we must keep for longer, such as financial and ledger records, tax records, signed agreements and audit logs. When a seller's services end, we delete or return its Recipient data, except for order records we need for tax, accounting, claims and legal purposes.

## 12. How we protect personal data

12.1 We use technical and organisational measures to protect personal data, including:
- encrypted connections to the Platform;
- two-factor sign-in for our staff and for fulfilment partners;
- secure session cookies to keep you signed in;
- alerts when there is a new sign-in to an account;
- a record of the IP address and device type used for each sign-in;
- audit logs of actions taken on the Platform, kept in a tamper-evident form;
- encryption of fulfilment partners' tax identification numbers;
- leaving card and bank details with Stripe, so that we never hold them;
- not storing identity document images or selfies; and
- deleting proof of address automatically after the retention period.

12.2 No system is completely secure. If a personal data breach happens that affects you, we will tell you and the relevant authority where this is required under ${dataProtection}. If the breach affects Recipient data, we will tell the seller without undue delay, as the Fulfilment Services Agreement says.

12.3 You can help by keeping your password and sign-in details safe, and by telling us straight away if you receive a sign-in alert you do not recognise.

## 13. Your rights

${rightsList(profile)}

13.3 To use any of your rights, contact us through the support channel in your account, or by email to the address published on our website. We may need to confirm your identity before we act on your request. We will respond within the time allowed under ${dataProtection}, and we will not normally charge you.

13.4 If you are a Recipient, the seller you bought from is the controller of your delivery data, so please contact it first. If you contact us, we will pass your request to the seller and help it respond.

${complaintClause(profile)}

## 14. Cookies and local storage

14.1 We use only strictly necessary cookies. They keep you signed in during a session and support the sign-in process. Without them, the Platform cannot work.

14.2 We also use your browser's local storage to remember preferences, such as whether the sidebar is open, the country you have selected and your voice setting, and to keep drafts of the public partner application. This information is kept in your browser.

14.3 We do not use advertising cookies or third-party tracking.

14.4 You can clear or block cookies and local storage in your browser settings, but parts of the Platform, including signing in, will then not work.

14.5 If you are sent to a page run by Stripe or Didit, for example to make a payment or complete your identity check, that provider may use its own cookies under its own policy.

## 15. Children

15.1 The Platform is not for anyone under 18. We do not knowingly collect personal data from children. If you believe a child has given us personal data, please contact us and we will delete it.

## 16. Changes to this policy

16.1 We may update this policy. We will tell you about any material change by email and on the Platform before it takes effect. The version shown on the Platform is the current one.

## 17. Contact us

17.1 If you have a question about this policy or how we use your personal data, please contact us through the support channel in your account, or by email to the address published on our website.`;
}
