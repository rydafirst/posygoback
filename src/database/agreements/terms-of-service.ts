import { LegalProfile } from "./legal-profiles";

export const TERMS_TITLE = "Terms of Service";

function consumerRightsWording(profile: LegalProfile): string {
  if (!profile.consumer) {
    return "the consumer protection laws that apply to you";
  }
  return `the consumer protection laws that apply to you, including, in ${profile.name}, ${profile.consumer}`;
}

export function termsOfServiceBody(profile: LegalProfile): string {
  const { name, governingLaw, courts } = profile;
  const consumerRights = consumerRightsWording(profile);

  return `## 1. About these terms

1.1 These Terms of Service are between Posygo ("Posygo", "we", "us" or "our") and you, the person or business that uses our website, seller dashboard, partner app, API or any of our other tools (together, the "Platform"). If you use the Platform for a business, you confirm that you have authority to accept these terms for it, and "you" then means that business.

1.2 Posygo stores a seller's stock in each country the seller chooses to sell in, and picks, packs and delivers each order inside that country. We do not ship goods from one country to another.

1.3 You accept these terms when you create an account, confirm that you accept them, or use the Platform. If you do not agree to them, please do not use the Platform.

1.4 This version of these terms is for people and businesses based in ${name}. The sections on governing law, courts and consumer rights reflect ${name}. All other terms are the same wherever we operate.

1.5 Our Privacy Policy explains how we collect, use and protect personal data. Please read it alongside these terms.

## 2. Definitions

2.1 In these terms, the following words have these meanings:
- **Account** means a seller account, a fulfilment partner account or a team member login on the Platform.
- **Agreement** means the Fulfilment Services Agreement or the Fulfilment Partner Agreement, whichever you have signed with us.
- **API Key** means a key we issue to a Seller so that its own systems can connect to our API.
- **Fee Schedule** means the published schedule of fees for each Storage Country referred to in the Fulfilment Services Agreement.
- **Fulfilment Partner** means an independent individual or business that stores and handles stock on our behalf under the Fulfilment Partner Agreement.
- **Fulfilment Partner Agreement** means our agreement with Fulfilment Partners, signed electronically on the Platform.
- **Fulfilment Services Agreement** means our agreement with Sellers, signed electronically on the Platform.
- **Posy** means the in-app helper described in section 9.
- **Recipient** means a person to whom an order is to be delivered.
- **Seller** means a business that uses the Platform to store its stock and fulfil its orders.
- **Storage Country** means each country a Seller has chosen for the storage and fulfilment of its stock.
- **Support Case** means a request for help or a report of a problem made through the Platform.
- **Team Member** means a person a Seller has invited to use its Account.
- **User Content** means anything you upload or submit to the Platform, including documents, photos, videos, product data, orders, CSV files and messages.

2.2 Headings do not affect interpretation. "Including" does not limit the words before it. A reference to a law includes that law as amended or replaced.

## 3. Who can use Posygo

3.1 Posygo is a service for businesses. Seller Accounts are for businesses acting in the course of their trade. Fulfilment Partner Accounts are for individuals and businesses who provide services to us independently. We do not sell goods or services to consumers.

3.2 You must be at least 18 years old to create or use an Account, to apply to become a Fulfilment Partner, or to accept these terms for a business.

3.3 Anyone may view our public website, check the progress of a delivery on our public tracking page using its tracking number, and submit an application to become a Fulfilment Partner. If you are waiting for a parcel, the seller you bought from is responsible for your purchase, and questions about the order itself should go to that seller.

3.4 If the law treats you as a consumer when you use any part of the Platform, nothing in these terms limits your rights under ${consumerRights}.

## 4. Accounts and security

4.1 You must give us accurate and complete information when you create an Account and keep it up to date.

4.2 Sellers sign up with a business name, email address and password, choose their Storage Countries and then verify their business. Verification involves company details, a contact person, a business document and an identity check of the contact person. Fulfilment Partners apply with a referee and then complete the checks described in the Fulfilment Partner Agreement. We may decline or withdraw verification as the relevant Agreement allows.

4.3 You must keep your password and any other sign-in details secret and must not share them with anyone. Each Team Member must use their own login.

4.4 Fulfilment Partners must use two-factor sign-in. Where we offer or require two-factor sign-in for any other Account, you must keep your second factor, such as an authenticator app or device, under your own control.

4.5 We send you an alert when there is a new sign-in to your Account. If you receive an alert you do not recognise, or you think someone else has access to your Account or an API Key, you must change your password and tell us immediately through the support channel in your account.

4.6 You are responsible for everything done through your Account, including by your Team Members and through your API Keys, except to the extent it is caused by our failure to take reasonable care.

## 5. Your agreement with us

5.1 Before we store any stock for you, you must sign the Fulfilment Services Agreement. It covers the services, fees, wallets, stock, orders, returns, claims, liability and Recipient data.

5.2 Before you receive or hold any stock, you must sign the Fulfilment Partner Agreement. It covers your independent status, verification, storage standards, custody, earnings, payouts, audits, performance and liability.

5.3 These terms apply to everyone who uses the Platform. They cover how you may use the Platform itself. Your Agreement covers our commercial relationship.

5.4 If there is any conflict between these terms and your Agreement, your Agreement wins. The Fee Schedule and the Earnings Schedule apply as your Agreement says.

## 6. Acceptable use

6.1 You must not use the Platform to:
- send, store, sell or arrange the delivery of anything that is illegal, or of goods that the Fulfilment Services Agreement prohibits or restricts without our approval;
- carry out any unlawful, fraudulent or deceptive activity, including money laundering;
- give false information, use a fake identity, impersonate anyone, use someone else's identity document or image, or help anyone pass a check they could not pass themselves;
- access any account, data or system you are not authorised to access;
- probe, scan or test the security of the Platform, or try to get around any sign-in, two-factor, permission, usage limit or other security control;
- scrape, crawl or harvest data from the Platform, including from the public tracking page, by any automated means;
- use the API in a way that is not documented, send excessive automated requests, or reverse engineer the Platform except where the law allows it;
- upload viruses, malware or any other harmful code;
- interfere with the performance or availability of the Platform for others;
- use personal data you see through the Platform for any purpose other than the one it was made available to you for;
- resell, sublicense or give anyone else access to the Platform without our written consent; or
- harass, threaten or abuse our staff, Fulfilment Partners, Sellers or anyone else.

6.2 If you find a security weakness in the Platform, please report it to us through the support channel and do not use or share it.

6.3 We may investigate any suspected breach of this section, remove User Content, revoke API Keys and suspend Accounts under section 15. We may also report suspected unlawful activity to the relevant authorities.

## 7. Your content

7.1 You keep ownership of your User Content. You give us a non-exclusive, worldwide, royalty-free licence to host, store, copy, process and display it as needed to provide the Platform and our services, to comply with the law and to enforce these terms and your Agreement.

7.2 You confirm that you have the right to upload your User Content, that it is accurate, and that uploading it does not break any law or anyone else's rights. If you give us personal data about other people, including Recipients and Team Members, you confirm that you are allowed to share it with us.

7.3 We may remove or block any User Content that we reasonably believe breaks these terms or the law.

## 8. API keys and integrations

8.1 Sellers can create orders manually, by CSV upload or through our API using an API Key. Orders created by any of these methods are treated in the same way, and you are responsible for their accuracy.

8.2 Each API Key is linked to your Account. You must treat it like a password, keep it on your own servers, and never put it in public code, websites or apps. If a key may have been exposed, you must revoke it on the Platform and create a new one.

8.3 We may revoke or replace an API Key if we suspect it has been compromised or misused, and we will tell you when we do.

8.4 We may set reasonable usage limits for the API and change the API over time. We will give you reasonable notice of changes that would stop an existing integration from working, except where a change is needed for security or by law.

8.5 If you connect your own software or a third-party tool to the API, you are responsible for it and for what it does with your Account, and that tool's own terms apply to your use of it.

## 9. Posy, the in-app helper

9.1 Posy is the helper inside the Platform. It answers questions about using Posygo. To draft an answer, Posy may send your question to Anthropic, which provides the Claude AI model.

9.2 Answers from Posy, including answers drafted by AI, may be incomplete, out of date or wrong. Before you rely on an answer about anything important, such as fees, deadlines, claims or your legal or tax obligations, check it against your Agreement, the Fee Schedule or the relevant page of the Platform, or ask us through the support channel. Posy does not give legal, tax or financial advice.

9.3 Posy cannot change your Agreement, agree fees, decide claims or disputes, waive any of our rights or make any commitment for us. If an answer from Posy conflicts with these terms or your Agreement, these terms or your Agreement apply.

9.4 Please do not type card numbers, passwords, identity document numbers or other sensitive information into Posy. The page removes numbers that look like card numbers before a question is sent, but you should not rely on this.

9.5 We log the questions asked, the page they were asked from and the outcome, so that we can provide support and improve Posy. Our Privacy Policy explains this in more detail.

## 10. Support cases

10.1 You can contact us through the support channel in your account. If you do not have an account, for example because you are applying to become a Fulfilment Partner, you can use the email address published on our website.

10.2 When something goes wrong on a page, Posy may offer to report a Support Case for you. The report includes the page, the error and the recent steps you took on that page. It records the labels of the fields you used, not what you typed into them. Our systems also record server failures automatically, with a log reference and the signed-in user, so that we can investigate them.

10.3 Some matters, such as disputes about receiving counts, fees, claims and statements, have their own processes and time limits in your Agreement. You must use those processes within those time limits.

## 11. Fees

11.1 Browsing our public website, using the public tracking page and applying to become a Fulfilment Partner are free.

11.2 Sellers pay a one-off activation fee once they have been verified and have signed the Fulfilment Services Agreement, and then pay fees for the services from a prepaid wallet held for each Storage Country. The amounts, currencies, taxes, deductions, changes and refunds are set out in the Fulfilment Services Agreement and the Fee Schedule.

11.3 Wallet top-ups and the activation fee are processed by Stripe. Your card details are handled by Stripe and are never stored by us.

11.4 Fulfilment Partners' earnings, any security deposit, deductions and payouts are set out in the Fulfilment Partner Agreement and the Earnings Schedule. Payouts are made through Stripe Connect, and your bank details are held by Stripe, not by us.

## 12. Intellectual property and feedback

12.1 We and our licensors own the Platform, including its software, design, content, documentation and the Posygo name and logo. While these terms apply, we give you a limited, non-exclusive, non-transferable and revocable right to use the Platform for its intended purpose.

12.2 If you send us ideas, suggestions or other feedback, we may use them freely and without any obligation to you. You do not have to give us feedback.

## 13. Service availability, changes and beta features

13.1 We aim to keep the Platform available at all times, but we do not promise that it will always be available or free from errors. We may need to take it offline for maintenance, and outages at our service providers may affect it.

13.2 We may change, add or remove features of the Platform. If we plan to remove a feature that is important to the services under your Agreement, we will give you reasonable notice. Changes to the services themselves are made under your Agreement.

13.3 We may label some features as beta or preview. These features are provided as they are, may change or be withdrawn at any time, and should not be relied on for anything critical.

## 14. Third-party services

14.1 The Platform relies on third-party services, including:
- Stripe, for the activation fee, wallet top-ups and Fulfilment Partner payouts through Stripe Connect, and as a fallback identity check for Fulfilment Partners through Stripe Identity;
- Didit, for identity checks; and
- Shippo and delivery carriers, for shipping labels, tracking and delivery.

14.2 Some of these services have their own terms and privacy policies, which may apply to you. For example, you must accept Stripe's terms to receive payouts through Stripe Connect.

14.3 Under the Fulfilment Services Agreement, we remain responsible to Sellers for the carriers and other subcontractors we use to perform the services, within the limits of that agreement. Otherwise, we are not responsible for third-party services or for their availability, although we take reasonable care in choosing them.

## 15. Suspension and closure

15.1 You may ask us to close your Account at any time through the support channel in your account. If you have signed an Agreement, ending it, and dealing with your stock, wallets, earnings or security deposit, follow the notice periods and steps in that Agreement.

15.2 We may suspend or restrict your access to the Platform immediately if:
- you breach section 6 or we reasonably suspect that you have;
- your Account or an API Key presents a security risk to the Platform or to others;
- we reasonably suspect fraud, a fake identity or other unlawful activity connected with your Account;
- you have not completed, or have failed, a verification check;
- a court, regulator or other authority requires us to; or
- your Agreement allows us to.

15.3 We will tell you why we have suspended your access, unless the law prevents us or doing so would harm security or an investigation. We will lift the suspension once the reason has been resolved.

15.4 We may close your Account by giving you at least 30 days' notice, or immediately for any of the reasons in section 15.2 that we reasonably consider serious. If you have signed an Agreement, closure is subject to the termination provisions of that Agreement.

15.5 When your Account closes, your access to the Platform ends. Please download any signed agreements, reports and records you need before then. We keep and delete personal data as our Privacy Policy explains. Sections 7.1, 12, 16 to 18, 21 and 22 continue to apply after your Account closes.

## 16. Disclaimers

16.1 Except as expressly set out in these terms or your Agreement, the Platform is provided "as is" and "as available", and we give no other promises about it, including that it will be fit for a particular purpose, to the extent the law allows.

16.2 We do not give legal, tax or regulatory advice. You are responsible for your own compliance, including your right to sell your goods in each Storage Country and your own tax obligations.

16.3 Nothing in these terms excludes any promise or right that the law says cannot be excluded, including rights under ${consumerRights} where they apply to you.

## 17. Limitation of liability

17.1 Nothing in these terms limits or excludes either party's liability for death or personal injury caused by negligence, for fraud or fraudulent misrepresentation, or for any other liability that cannot be limited or excluded under ${governingLaw}. Nothing in these terms limits your rights under ${consumerRights} where they apply to you.

17.2 If you have signed an Agreement, the liability, claims and compensation provisions of that Agreement apply to all claims between us connected with the Platform, and sections 17.3 and 17.4 do not apply.

17.3 Subject to section 17.1, neither of us is liable to the other for any loss of profit, revenue, business, goodwill or anticipated savings, or for any indirect or consequential loss, however it arises.

17.4 Subject to section 17.1, our total liability to you arising under or in connection with these terms, whether in contract, tort (including negligence) or otherwise, is limited to the total fees you paid us in the 12 months before the event giving rise to the claim.

17.5 We are not liable for any loss to the extent it is caused by your breach of these terms or your Agreement, by inaccurate information you gave us, by a third-party service outside our control except as section 14.3 says, or by an event described in section 21.1.

## 18. Indemnity

18.1 You will indemnify us against all claims, losses, fines and reasonable costs, including legal costs, that we incur because of your breach of these terms, your User Content, the use of your API Keys, or your breach of any law.

18.2 The indemnities in your Agreement also apply. Where they cover the same matter as section 18.1, your Agreement applies.

18.3 This section does not apply to you to the extent the law does not allow it to be applied to a consumer.

## 19. Changes to these terms

19.1 We may update these terms. We will give you at least 30 days' notice of any material change by email and on the Platform, except for changes required by law or for security, which may take effect sooner.

19.2 If you continue to use the Platform after a change takes effect, you accept the updated terms. If you do not accept them, you must stop using the Platform and may close your Account under section 15.1.

## 20. Notices

20.1 We send notices to the email address on your Account or through the Platform. You send notices to us through the support channel in your account or by email to the address published on our website.

20.2 A notice sent by email or through the Platform is treated as received on the next business day in ${name} after it is sent. Where these terms require something in writing, email and notices through the Platform satisfy that requirement.

## 21. General

21.1 Neither of us is liable for any failure or delay caused by events beyond our reasonable control, such as natural disasters, fire, flood, war, civil unrest, epidemics, failures of utilities or networks, and acts of government.

21.2 You may not transfer your rights or obligations under these terms without our written consent. We may transfer them to a company in our group or to a buyer of all or part of our business, and will tell you if we do.

21.3 If any part of these terms is invalid or unenforceable, the rest continues in force. A delay in enforcing a right is not a waiver of it. No one other than you and us may enforce these terms. If these terms are translated, the English version prevails.

## 22. Governing law and courts

22.1 These terms, and any dispute or claim arising out of or in connection with them, are governed by ${governingLaw}.

22.2 We will both try to resolve any dispute in good faith through discussion for at least 30 days. If it is not resolved, each of us submits to the exclusive jurisdiction of ${courts}, except that either of us may seek urgent interim relief from any court with jurisdiction.

22.3 If the law treats you as a consumer, you keep any right you have to bring proceedings in the courts where you live, and any protections of the law where you live that cannot be excluded by agreement.

## 23. Contact us

23.1 If you have a question about these terms, please contact us through the support channel in your account or by email to the address published on our website.`;
}
