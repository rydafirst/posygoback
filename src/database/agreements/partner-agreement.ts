import { LegalProfile } from "./legal-profiles";

export const PARTNER_AGREEMENT_TITLE = "Fulfilment Partner Agreement";

export function partnerAgreementBody(profile: LegalProfile): string {
  const { name, currency, governingLaw, courts, dataProtection, partnerTax } = profile;

  return `## 1. Parties and electronic signature

1.1 This Fulfilment Partner Agreement is between Posygo ("Posygo", "we", "us" or "our") and the individual or business that has applied to become a fulfilment partner and signs this agreement electronically ("you" or "your"). If you sign on behalf of a business, you confirm that you have authority to bind that business, and "you" then means that business.

1.2 You accept this agreement by entering your full name and confirming your signature on the signing page. Your electronic signature has the same legal effect as a handwritten signature, and you agree not to challenge the validity or enforceability of this agreement on the ground that it was signed electronically.

1.3 This version of the agreement is for fulfilment partners operating in ${name} and is governed by ${governingLaw}. The clauses on governing law, courts, data protection, currency, tax and right to work reflect ${name}. All other terms are the same wherever we operate.

1.4 This agreement starts on the date you sign it. You may not receive or hold any Goods until we have confirmed in writing that your verification is complete and that you are approved to start.

## 2. Definitions

2.1 In this agreement, the following words have these meanings:
- **Approved Personnel** means any individual we have verified and approved in writing to handle Goods on your behalf.
- **Business Day** means a day other than a Saturday, Sunday or public holiday in ${name}.
- **Confidential Information** means any information of a confidential nature that you receive in connection with this agreement, including information about Sellers, Goods, Recipients, Orders, our pricing and our systems.
- **Custody Record** means the record on the Platform of every Good you receive, store, move, pick, pack, dispatch, return or hand over, including scans, photographs and timestamps.
- **Earnings** means the amounts payable to you under the Earnings Schedule.
- **Earnings Schedule** means the published schedule of earnings rates, Tier rules, security deposit amounts and insurance requirements for ${name}, as updated under section 9.
- **Goods** means any products or stock that Sellers have entrusted to us and that are delivered to you or held by you, including returned items.
- **Inbound Shipment** means a delivery of Goods to your Storage Space and the advance notice for it on the Platform.
- **Loss** means any Goods that are missing, damaged, destroyed or diverted while in your custody.
- **Order** means an instruction on the Platform to pick, pack and dispatch Goods to a Recipient.
- **Payout Account** means the bank or payment account in your own name that you have registered and that we have verified for receiving Earnings.
- **Platform** means our website, partner app and related tools.
- **Recipient** means the person to whom an Order is to be delivered.
- **Recipient Data** means personal data about Recipients that you access in order to fulfil Orders or process returns.
- **Referee** means the person you named in your application who can vouch for your character and reliability.
- **Scorecard** means the regular report of your performance against the measures described in section 12.
- **Security Deposit** means the deposit described in section 8.
- **Seller** means a business that uses our services to store and fulfil its Goods.
- **Service Levels** means the timeframes and quality standards for receiving, picking, packing and dispatching published on the Platform for your Tier.
- **Storage Space** means the premises or part of premises that we have approved for you to store Goods.
- **Test Order** means an Order we create, without telling you in advance, to check your performance.
- **Tier** means the performance level assigned to you under section 12.

2.2 Headings are for convenience only and do not affect interpretation. Words such as "including" and "for example" do not limit the words that come before them. A reference to a law includes that law as amended or replaced from time to time.

## 3. Independent contractor status

3.1 You are an independent contractor. Nothing in this agreement makes you our employee, worker, agent or joint venturer, and you have no authority to bind us or to make any commitment on our behalf.

3.2 You decide how to organise your own business, subject to meeting the standards, Service Levels and other requirements in this agreement. You may provide services to others, as long as doing so does not affect your ability to comply with this agreement and you never store anyone else's goods in a way that mixes them with the Goods.

3.3 You are responsible for your own equipment, premises costs, transport, staff and expenses, unless the Earnings Schedule says otherwise.

3.4 You are responsible for any people you engage to help you. Only Approved Personnel may handle Goods, and you are responsible for their acts and omissions as if they were your own.

## 4. Eligibility and verification

4.1 To become and remain a fulfilment partner, you must:
- be at least 18 years old, or, if you are a business, be properly registered and in good standing;
- give us a Referee who confirms your application;
- complete an identity check, including a valid identity document and a matching selfie;
- provide proof of your address;
- provide evidence of your Storage Space, including photographs, and allow an inspection if we ask;
- complete a declaration that you have the right to work and that you will meet your tax obligations;
- sign this agreement;
- register a Payout Account in your own name; and
- arrange any insurance and pay any Security Deposit required for your Tier.

4.2 You authorise us to carry out these checks and to use third-party verification services for them. You confirm that all information and documents you give us are true, complete and your own. Giving false or misleading information is a serious breach of this agreement.

4.3 Verification is ongoing. We may repeat any check at any time, ask you to update your documents when they expire, and carry out new checks on you and your Approved Personnel. You must tell us within 2 Business Days of any change to your identity details, address, Storage Space, right to work, Payout Account or insurance, and of any criminal charge or conviction involving dishonesty, theft or violence, to the extent the law allows us to ask for this information.

4.4 We may decline an application, or withdraw your approval, at our discretion, including where a check is not passed, is not completed, or raises concerns we cannot resolve.

## 5. Storage space standards

5.1 Your Storage Space must at all times be:
- secure, with lockable doors and windows, and access controlled by you;
- dry, clean, well ventilated and free from damp, pests and strong odours;
- used only for storing Goods and not open to anyone other than you and your Approved Personnel;
- kept free of pets and inaccessible to children;
- equipped with working smoke detection and a suitable fire extinguisher, and kept free of fire hazards, with clear exits; and
- large enough for the volume of Goods allocated to you, with Goods stored off the floor and organised by location.

5.2 You must not move the Goods to any other premises, or change your Storage Space, without our prior written approval.

5.3 You must make sure that you are allowed to use your Storage Space for this purpose, including any consent needed from a landlord, lender or insurer, and that its use complies with local rules.

5.4 We may inspect your Storage Space at any reasonable time, on notice or without notice as described in section 11.

## 6. Custody duties

6.1 When an Inbound Shipment arrives, you must receive it only against its notice on the Platform. You must:
- check and count every box and unit;
- photograph the boxes on arrival and any damage or discrepancy;
- record the actual count on the Platform the same Business Day, and report any shortage, excess or damage immediately; and
- refuse or quarantine any delivery that has no notice or that appears to contain unsafe, illegal or unexpected items, and contact us straight away.

6.2 You must label each unit or box as instructed, assign it to a storage location, and record that location on the Platform. Goods must be kept in their recorded location.

6.3 You must record every movement of Goods on the Platform at the time it happens, so that the Custody Record is accurate and complete at all times. No Goods may be moved, opened or handed over without a corresponding record.

6.4 For each Order, you must pick the correct items, scan them against the Order, pack them securely in the packaging we specify, apply the shipping label, and hand the parcel to the carrier with a dispatch scan, all within the Service Levels for your Tier.

6.5 You must receive, inspect, photograph and record returned items as instructed on the Platform.

6.6 You must keep the Platform app logged in only on devices you control, keep your login details secure, and never share them with anyone other than Approved Personnel using their own logins.

6.7 You must tell us immediately of any incident that may affect the Goods, including theft, break-in, fire, flood, pest infestation or damage, and preserve any evidence.

## 7. Non-diversion

7.1 The Goods belong to Sellers. You must never use, sell, lend, give away, pledge, rent out, swap, display, wear, sample, open, or otherwise deal with any Goods for any purpose other than performing this agreement, and you must never divert Goods to anyone or anywhere other than as instructed through the Platform.

7.2 This obligation is absolute. It applies even if you intend to replace or pay for the Goods, even if you believe Earnings or other amounts are owed to you, and even for a short time. You must not claim any lien or right to hold the Goods against us or any Seller, and you waive any such right to the extent the law allows.

7.3 Any breach of this section is a serious breach of this agreement. We may end this agreement immediately, recover the full value of the diverted Goods and our costs from you without the limits in section 16, and withhold any Earnings to the extent of those amounts.

7.4 Diverting Goods may also be a criminal offence. We may report any suspected diversion to the police or other authorities, and share evidence, including the Custody Record and your verification information, with them and with the affected Seller.

## 8. Insurance and security deposit

8.1 Depending on your Tier, the value of Goods you hold and the requirements for ${name} in the Earnings Schedule, we may require you to hold insurance, which may include public liability cover, cover for goods in your custody, and any cover the law requires for people you engage. You must provide evidence of cover when we ask and tell us immediately if it is cancelled, reduced or not renewed.

8.2 We may require you to pay a Security Deposit, in ${currency}, before you receive Goods or before you move to a higher Tier. The amount is set out in the Earnings Schedule. With your agreement, we may build up the Security Deposit by deductions from your Earnings over an agreed period.

8.3 We hold the Security Deposit as security for your obligations under this agreement. It does not earn interest unless the law requires it. We may use it to recover any amount you owe us under section 10 or otherwise under this agreement, and you must top it up to the required amount within 14 days after we tell you we have used it.

8.4 Within 60 days after this agreement ends and all Goods have been handed over and reconciled, we will return the Security Deposit to your Payout Account, less any amounts you owe us, with a statement of any deductions.

## 9. Earnings, statements and payouts

9.1 We will pay you Earnings for the work you perform at the rates in the Earnings Schedule for ${name}, which may include rates per box received, per box stored per month, per Order picked and packed, and per return processed, together with any Tier bonuses. Earnings are calculated from the Custody Record.

9.2 We may change the Earnings Schedule by giving you at least 30 days' notice by email and on the Platform. If you do not accept a change, you may end this agreement by notice before the change takes effect. Changes that increase rates may take effect immediately.

9.3 We will issue you a monthly statement on the Platform, normally within 5 Business Days after the end of each calendar month, showing your Earnings, any deductions and the amount payable. You must raise any dispute about a statement within 14 days after it is issued, and we will review it in good faith.

9.4 We will pay the amount shown in each statement in ${currency} to your Payout Account, normally within 10 Business Days after the statement is issued. We only pay Earnings to a verified Payout Account in your own name.

9.5 We may deduct from your Earnings, or withhold from a payout:
- amounts recoverable for Losses under section 10, after the Security Deposit has been applied;
- any amount needed to restore your Security Deposit, where you have agreed to this;
- overpayments made to you in error;
- any amount connected with an open investigation into a suspected Loss or diversion, limited to the amount at stake, until it is decided; and
- any tax we are required by law to deduct.

9.6 ${partnerTax} You will keep your own records and provide any invoices or tax information we reasonably need to pay you lawfully. You will indemnify us for any tax, contributions or penalties we have to pay because you did not meet these responsibilities.

## 10. Losses in custody

10.1 You are responsible for the Goods from the time you sign for them, or record their receipt on the Platform, until they are handed to a carrier with a dispatch scan, collected by us or our nominee, or otherwise released as instructed through the Platform.

10.2 If we believe a Loss has occurred in your custody, we will notify you through the Platform with the details and the evidence we rely on, such as stock count results, the Custody Record, Seller complaints or carrier records.

10.3 You may respond within 7 days after our notice, with any explanation and evidence, such as photographs, scans, incident reports or police reports. We will consider your response and decide whether the Loss is proven and whether you are responsible, and tell you our decision with reasons. You may ask us to review the decision once, within 7 days, if you have new evidence.

10.4 You are not responsible for a Loss to the extent you show that it was caused by inadequate Seller packaging, an inherent defect in the Goods, our own error, or an event described in section 19.1 that you could not reasonably have prevented by meeting the standards in this agreement.

10.5 For a proven Loss for which you are responsible, the amount recoverable is the compensation and fees we credited to the Seller for the Goods concerned, plus our reasonable costs of investigation. For a Loss caused by diversion, section 7.3 applies.

10.6 We will recover the amount first from your Security Deposit and then from your Earnings. Any amount still unpaid is a debt you owe us, and you must pay it within 30 days after we ask.

## 11. Audits, stock counts and test orders

11.1 We may carry out audits of your Storage Space, the Goods and the Custody Record. We will normally give you at least 24 hours' notice, but we may visit without notice if we reasonably suspect a breach of this agreement or a risk to the Goods.

11.2 We may ask you to carry out stock counts, including cycle counts of selected locations and full counts of all Goods, and to submit the results on the Platform within the time we specify. We or our nominee may attend or carry out counts ourselves.

11.3 You must explain any discrepancy between a count and the Custody Record within 48 hours, and help us investigate it.

11.4 We may create Test Orders at any time without telling you in advance. You must fulfil every Order, including Test Orders, in the same way and to the same standard. Test Orders count towards your Scorecard and are paid at the normal rates.

11.5 You must give us and our nominees reasonable access to your Storage Space, records and Approved Personnel for these purposes, and cooperate fully.

## 12. Performance, tiers and scorecards

12.1 We measure your performance using measures that may include receiving accuracy, stock accuracy, on-time dispatch, picking and packing accuracy, damage rates, Test Order results, audit results and response times. We will publish the measures and how they are calculated on the Platform.

12.2 We will give you a Scorecard on the Platform at least once a month.

12.3 Your Tier determines matters such as the volume and value of Goods we allocate to you, your Service Levels, your earnings rates and bonuses, and your Security Deposit and insurance requirements, as set out in the Earnings Schedule. We may move you to a higher or lower Tier based on your Scorecard.

12.4 If your performance falls below the standard for your Tier, we may agree an improvement plan with you. If your performance does not improve, or falls significantly below the standard, we may reduce the Goods allocated to you, move Goods to other premises, or end this agreement.

12.5 We do not guarantee any minimum volume of Goods, Orders or Earnings.

## 13. Confidentiality and data protection

13.1 You must keep all Confidential Information confidential, use it only to perform this agreement, and not disclose it to anyone other than Approved Personnel who need it and who are bound by the same duties. This obligation continues after this agreement ends.

13.2 You must not contact Sellers or Recipients directly, except as instructed through the Platform, and must not take any photographs or recordings of Goods, labels or documents except as this agreement requires.

13.3 When you process Recipient Data, you act as our processor or, where we process it for a Seller, as our sub-processor. You must comply with ${dataProtection}, and any other data protection laws that apply ("data protection laws"), and you must:
- use Recipient Data only to fulfil Orders and process returns, and only on our instructions through the Platform;
- never copy, store, sell, share or use Recipient Data for any other purpose, including marketing or contacting Recipients;
- keep printed labels and documents secure and destroy them securely when no longer needed;
- protect devices you use for the Platform with a password or other lock;
- make sure Approved Personnel are bound by a duty of confidentiality;
- tell us immediately, and in any case within 24 hours, if you become aware of any loss, misuse or unauthorised access to Recipient Data;
- help us respond to requests from individuals and from regulators; and
- delete any Recipient Data you hold when this agreement ends or when we ask.

13.4 We are the controller of the personal data we collect about you and your Approved Personnel for verification, payments and performance management, and we handle it in line with our privacy notice. You must give your Approved Personnel the information they need about this.

## 14. Health and safety

14.1 You are responsible for the health and safety of yourself, your Approved Personnel and anyone else at your Storage Space, and for complying with the health and safety laws of ${name} that apply to you.

14.2 You must use safe lifting and handling methods, keep walkways and exits clear, stack Goods safely, and follow any handling instructions for particular Goods.

14.3 You must not handle any item that appears hazardous, leaking or damaged in a way that could cause harm. Isolate it if safe to do so, and contact us immediately.

14.4 You must report any accident, injury or dangerous incident involving the Goods to us within 24 hours.

## 15. Suspension, termination and handover

15.1 Either of us may end this agreement for any reason by giving the other at least 30 days' written notice.

15.2 We may suspend you from receiving new Goods or Orders, or end this agreement immediately by written notice, if:
- you breach section 7, or we reasonably suspect you have;
- any information you gave us during verification or afterwards is false or misleading;
- you fail an ongoing check or no longer meet the eligibility requirements;
- you fail Test Orders or audits repeatedly or seriously;
- you commit any other serious breach of this agreement that cannot be remedied, or that is not remedied within 7 days after we ask;
- your Storage Space no longer meets the standards in section 5, or the Goods are at risk;
- you become insolvent or stop carrying on business; or
- a court, regulator or other authority requires us to.

15.3 At any time, whether or not this agreement is ending, we may ask you to hand over some or all of the Goods. You must make all Goods requested, together with the related records, available for collection by us or our nominee within 48 hours of our request, at the Storage Space, and cooperate with a reconciliation count at handover.

15.4 When this agreement ends, you must hand over all Goods under section 15.3, return any packaging, labels and equipment we provided, and delete all Recipient Data and Confidential Information you hold. If you do not hand over the Goods as required, we may take any lawful step to recover them, and you must pay our reasonable costs.

15.5 After handover and reconciliation, we will pay any Earnings due, less deductions allowed by this agreement, and deal with the Security Deposit under section 8.4.

15.6 Sections 7, 8.3, 8.4, 9.5, 9.6, 10, 13, 15, 16, 18 and 19, and any other provisions that by their nature are intended to continue, survive the end of this agreement.

## 16. Liability

16.1 Nothing in this agreement limits or excludes either party's liability for death or personal injury caused by negligence, for fraud or fraudulent misrepresentation, or for any other liability that cannot be limited or excluded under ${governingLaw}.

16.2 Subject to section 16.1, neither of us is liable to the other for any loss of profit, revenue, business, goodwill or anticipated savings, or for any indirect or consequential loss, however it arises.

16.3 Subject to section 16.1, our total liability to you arising under or in connection with this agreement, whether in contract, tort (including negligence) or otherwise, is limited to the total Earnings paid to you in the 12 months before the event giving rise to the claim.

16.4 Your liability for Losses is set out in section 10. Your liability for diversion under section 7, for wilful misconduct, and for your indemnities under this agreement is not limited.

16.5 You will indemnify us against all claims, losses, fines and reasonable costs, including legal costs, that we incur because of your breach of sections 5, 7, 13 or 14, or because of any claim by your Approved Personnel or anyone you engage.

## 17. Changes

17.1 We may update this agreement from time to time. We will give you at least 30 days' notice of any material change by email and on the Platform. Changes required by law, or needed to protect the security of the Goods or the Platform, may take effect sooner.

17.2 For material changes, we may ask you to review and sign the updated agreement on the Platform. Until you do, we may stop allocating new Goods or Orders to you. If you do not accept an updated agreement, you may end this agreement under section 15.1.

17.3 Changes to the Earnings Schedule are made under section 9.2. Any other change to this agreement must be agreed by both of us in writing, which includes agreement through the Platform.

## 18. Electronic signature and records

18.1 When you sign this agreement, we record the name you entered, your account details and email address, your IP address, the date and time of signing, the version of the agreement, and a SHA-256 fingerprint of the exact text you were shown.

18.2 The fingerprint allows either of us to confirm later that the text of the agreement has not changed since you signed it.

18.3 We keep these records and a copy of the signed text for as long as this agreement is in force and for as long afterwards as the law requires or as needed to deal with any dispute. You can download a copy of your signed agreement from the Platform at any time.

18.4 You agree that these records, and the Custody Record, are evidence of the matters they record and may be relied on in any proceedings. Where this agreement requires notice or agreement in writing, email and notices through the Platform satisfy that requirement.

## 19. General

19.1 Neither of us is liable for any failure or delay in performing our obligations caused by events beyond our reasonable control, including natural disasters, fire, flood, war, terrorism, civil unrest, epidemics, failures of public utilities or networks, and acts of government. The affected party must tell the other promptly and take reasonable steps to protect the Goods and limit the effects. This section does not excuse a breach of section 7.

19.2 You may not assign, transfer or subcontract this agreement, or any rights or obligations under it, without our prior written consent. We may assign or transfer this agreement to a company in our group or to a buyer of all or part of our business, and will tell you if we do.

19.3 We will send notices to you by email to the address on your account or through the Platform. You must send notices to us through the support channel on the Platform or by email to the address published on the Platform for that purpose. A notice sent by email or through the Platform is treated as received on the next Business Day after it is sent.

19.4 This agreement, together with the Earnings Schedule, the Service Levels and the policies on the Platform that it refers to, is the entire agreement between us and replaces any earlier understandings. Neither of us has relied on any statement that is not set out in this agreement.

19.5 If any part of this agreement is found to be invalid or unenforceable, that part will be modified to the minimum extent needed to make it enforceable, and the rest of this agreement will continue in force.

19.6 A delay or failure to enforce any right under this agreement is not a waiver of that right.

19.7 No one other than you and us has any right to enforce this agreement.

19.8 If this agreement is translated, the English version prevails.

19.9 This agreement, and any dispute or claim arising out of or in connection with it, is governed by ${governingLaw}. We will both try to resolve any dispute in good faith through discussion for at least 30 days. If it is not resolved, each of us submits to the exclusive jurisdiction of ${courts}, except that either of us may seek urgent interim relief, including to recover Goods, from any court with jurisdiction.`;
}
