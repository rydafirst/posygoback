import { LegalProfile } from "./legal-profiles";

export const VENDOR_AGREEMENT_TITLE = "Fulfilment Services Agreement";

function consumerLawWording(profile: LegalProfile): string {
  if (!profile.consumer) {
    return "the consumer protection laws of each Storage Country";
  }
  return `the consumer protection laws of each Storage Country, including, in ${profile.name}, ${profile.consumer}`;
}

export function vendorAgreementBody(profile: LegalProfile): string {
  const { name, currency, governingLaw, courts, dataProtection } = profile;
  const consumerLaw = consumerLawWording(profile);

  return `## 1. Parties and electronic signature

1.1 This Fulfilment Services Agreement is between Posygo ("Posygo", "we", "us" or "our") and the person or business that creates a seller account on our Platform and signs it electronically ("you" or "your"). If you sign for a business, you confirm you have authority to bind it, and "you" means that business.

1.2 You accept this agreement by entering your full name and confirming your signature on the signing page. Your electronic signature has the same effect as a handwritten one, and you will not challenge this agreement on the ground that it was signed electronically.

1.3 This agreement is governed by ${governingLaw}.

1.4 This agreement starts on the date you sign it and continues until it is ended under section 18.

## 2. Definitions

2.1 In this agreement, the following words have these meanings:
- **Account** means your seller account on the Platform.
- **Activation Fee** means the one-off fee described in section 4.
- **Business Day** means a day other than a Saturday, Sunday or public holiday in the relevant Storage Country.
- **Claim** means a request for compensation for lost or damaged Goods made under section 12.
- **Confidential Information** means confidential information one of us discloses to the other under this agreement, including pricing, product and customer information and Platform technical details.
- **Declared Cost Value** means the cost to you of one unit of Goods, excluding your profit margin, taxes and transport costs, as stated by you in the relevant Inbound Shipment.
- **Fee Schedule** means the published schedule of our fees, compensation caps, cut-off times and service levels for each Storage Country, as updated under section 10.
- **Goods** means the products and stock you send to us or that we hold for you.
- **Inbound Shipment** means a delivery of Goods to our facilities and the advance notice you create for it on the Platform.
- **Order** means an instruction to pick, pack and deliver Goods to a Recipient, whether created manually, by CSV upload or through our API.
- **Platform** means our website, seller dashboard, API and related tools.
- **Prohibited Goods** means the goods described in section 7.1.
- **Recipient** means the person to whom an Order is to be delivered.
- **Recipient Data** means personal data about Recipients that you give us, or that we collect, in order to fulfil Orders and process returns.
- **Services** means the services described in section 3.
- **Storage Country** means each country you select for the storage and fulfilment of your Goods.
- **Subcontractor** means any third party we engage to perform part of the Services, including operators of storage facilities and delivery carriers.
- **Wallet** means the prepaid balance held on your Account for a Storage Country.

2.2 Headings do not affect interpretation. "Including" does not limit the words before it. A reference to a law includes that law as amended or replaced.

## 3. The services

3.1 We provide storage and order fulfilment services within each Storage Country you select. In each Storage Country we will:
- receive Inbound Shipments at our facilities and count the Goods;
- store the Goods securely;
- pick, pack and dispatch the Goods for each Order;
- arrange delivery of each Order to its Recipient through a carrier operating in that Storage Country;
- process returns you start on the Platform; and
- give you reporting on the Platform for stock levels, Orders, returns, fees and Wallet balances.

3.2 We will perform the Services with reasonable skill and care and in line with the service levels in the Fee Schedule, which are targets rather than guarantees unless the Fee Schedule says otherwise.

3.3 Each Storage Country operates separately. Goods held in a Storage Country are stored only in that country and delivered only to Recipients in that country. Getting your Goods into a Storage Country, including any import formalities, duties and taxes, is your responsibility.

3.4 We are not the seller of the Goods. We do not set prices, take payment from your buyers or deal with your buyers on your behalf, except to the extent needed to deliver Orders and process returns under this agreement.

## 4. Account, verification and activation fee

4.1 To use the Services you must create an Account and keep the information in it accurate, complete and up to date.

4.2 We verify every seller before activating an Account. Verification may include checks on your identity, business registration, address, payment method and the products you plan to sell. You agree to provide the documents and information we reasonably ask for, and you authorise us to use third-party verification services for this purpose. We may repeat these checks at any time.

4.3 Once you have been verified and have signed this agreement, you must pay the Activation Fee to make your Account live. The Activation Fee is US$10 or the equivalent amount in ${currency} or another local currency shown at checkout. It is a one-off fee and is not refundable once your Account is live.

4.4 We may refuse to verify or activate an Account, or close an Account, at our discretion, including where we cannot verify your information, where we suspect fraud or a breach of law, or where the products you plan to sell are Prohibited Goods. If we refuse to activate your Account before it goes live, we will refund any Activation Fee you have paid.

4.5 You are responsible for everything done through your Account, including through your API keys, and must keep your login details and keys secure.

## 5. Storage countries

5.1 You may choose one or more Storage Countries from those available on the Platform. You may add Storage Countries later, subject to any additional verification that applies in that country.

5.2 Goods are held and delivered within each Storage Country only. We will not move Goods from one Storage Country to another, or deliver Goods to Recipients outside the Storage Country in which they are stored.

5.3 Each Storage Country has its own Fee Schedule, its own Wallet and its own currency. For ${name}, that currency is ${currency}.

5.4 You are responsible for making sure you are allowed to sell the Goods in each Storage Country, and for any tax registration your sales there require.

5.5 We may stop offering the Services in a Storage Country by giving you at least 60 days' written notice. In that case, section 18.6 applies to the Goods held in that country, and the remaining top-up balance of your Wallet for that country will be refunded under section 10.8.

## 6. Sending stock in

6.1 Before sending any Goods, you must create an Inbound Shipment on the Platform. Each Inbound Shipment must accurately state the products, SKUs, quantities, number of boxes, Declared Cost Value, expected arrival date and any special handling requirements.

6.2 You must pack and label Goods in line with the packaging and labelling requirements published on the Platform, including:
- marking each box clearly with its Inbound Shipment reference;
- making sure each unit carries a scannable barcode that matches the SKU in the Inbound Shipment;
- using packaging strong enough to protect the Goods during transport, handling and storage; and
- clearly marking fragile, heavy or temperature-sensitive items.

6.3 You must arrange and pay for transport of each Inbound Shipment to the address we give you, within the delivery window shown on the Platform.

6.4 We will count the boxes and units received, photograph the Goods and record any visible damage, and then update your stock records on the Platform. Our receiving count is final unless you raise a dispute through the Platform within 7 days after the receiving record is posted, with supporting evidence such as supplier invoices, packing lists or carrier proof of delivery. We will investigate any dispute in good faith and correct our records if the evidence shows that our count was wrong.

6.5 We may refuse, or hold at your cost, any Inbound Shipment that:
- arrives without a valid Inbound Shipment notice;
- differs materially from its Inbound Shipment notice;
- is damaged, leaking, contaminated or unsafe to handle;
- is not packed or labelled as required; or
- contains, or that we reasonably suspect contains, Prohibited Goods or restricted goods that we have not approved.

6.6 If we refuse an Inbound Shipment, you must arrange its collection within 14 days of our notice. If you do not, we may dispose of it after a further 7 days' written notice, at your cost.

## 7. Prohibited and restricted goods

7.1 You must not send us, and we will not store or deliver, any of the following Prohibited Goods:
- weapons, ammunition, explosives, fireworks and their parts;
- illegal drugs, controlled substances and drug paraphernalia;
- hazardous materials, including flammable, corrosive, toxic, radioactive or pressurised goods, unless the Fee Schedule for the Storage Country expressly allows them;
- counterfeit goods and goods that infringe anyone's intellectual property rights;
- stolen goods or goods obtained unlawfully;
- live animals, plants and seeds;
- cash, precious metals, loose gemstones and negotiable instruments;
- perishable goods that need refrigeration or freezing;
- goods that have been recalled or that do not meet the product safety rules of the Storage Country; and
- any goods whose sale, storage or delivery is unlawful in the Storage Country.

7.2 Some goods are restricted and may only be sent with our prior written approval and on the conditions we set. These include alcohol, tobacco and vaping products, medicines, food supplements, cosmetics, lithium batteries, goods with an expiry date and goods with a unit value above the limit in the Fee Schedule.

7.3 If we find Prohibited Goods, or restricted goods that we have not approved, we may refuse them, quarantine them, return them to you at your cost, or hand them to the relevant authorities where the law requires us to. You must pay all costs we incur as a result, and section 13.4 applies.

## 8. Orders and fulfilment

8.1 You may create Orders manually on the Platform, by CSV upload or through our API. Each Order must include the Recipient's full name, a complete delivery address in the Storage Country, a contact telephone number, the SKUs and quantities, and the delivery service you have chosen.

8.2 You are responsible for the accuracy of all Order and Recipient details. If a delivery fails, is delayed or is returned because the details you gave us were wrong or incomplete, you must pay the resulting fees, including redelivery and return shipping.

8.3 We will process an Order only if enough stock of the ordered Goods is available in that Storage Country and your Wallet has enough funds to cover the fees for that Order. Orders received before the cut-off time in the Fee Schedule will normally be dispatched on the same Business Day, and later Orders on the next Business Day.

8.4 You may cancel an Order through the Platform at any time until it is marked as packed. Once an Order has been packed it cannot be cancelled, but you may start a return once it has been delivered, or ask us to request interception from the carrier where the carrier allows it, at your cost.

8.5 Delivery times are estimates. We will give you tracking information where the carrier provides it, and the carrier's proof of delivery is evidence that an Order was delivered.

8.6 You may ask us to remove Goods from our facilities and deliver them to an address in the same Storage Country. Removal fees in the Fee Schedule apply.

## 9. Returns

9.1 You may start a return on the Platform for any Order we have delivered. We will provide return instructions or a return label for you to pass to the Recipient. Return shipping is charged at the carrier price plus handling, as set out in the Fee Schedule.

9.2 When a return arrives, we will inspect and photograph the Goods and, in line with your return settings on the Platform, either restock them as sellable, hold them as damaged, or dispose of them.

9.3 Orders returned to us by the carrier as undeliverable are treated as returns and processed in the same way.

9.4 Returns that arrive without a return started on the Platform and that we cannot match to your Account will be held for 30 days and may then be disposed of after notice on the Platform.

9.5 You are responsible for dealing with your buyers about returns, including refunds, exchanges and their legal rights. We do not issue refunds to your buyers.

## 10. Fees, wallet and payment

10.1 You must pay our fees as set out in the Fee Schedule for each Storage Country. The fees include:
- a receiving fee for each box we receive;
- a monthly storage fee for each box we store;
- a fulfilment fee for each Order;
- shipping, charged at the carrier's price plus a handling charge; and
- fees for returns, removals, relabelling and other optional services you choose.

10.2 We publish the Fee Schedule for each Storage Country on the Platform. We may change the Fee Schedule by giving you at least 30 days' notice by email and on the Platform. If you do not accept a change, you may end this agreement by notice before the change takes effect. Changes that reduce fees may take effect immediately.

10.3 You must keep a prepaid Wallet for each Storage Country you use. Each Wallet is held in the local currency of its Storage Country; for ${name} that is ${currency}. You top up a Wallet using the payment methods offered on the Platform. A Wallet is a prepaid balance for paying our fees only. It is not a bank account, it does not earn interest, and its balance cannot be transferred between Storage Countries or to anyone else.

10.4 We deduct fees from the relevant Wallet as they become due. Receiving fees are deducted when we receive Goods, fulfilment and shipping fees when an Order is dispatched, and return fees when a return is processed. Storage fees are calculated for each box held during a calendar month, using the method in the Fee Schedule, and are deducted monthly in arrears.

10.5 If your Wallet does not have enough funds for an Order, we will hold that Order and later Orders until you top up, and we are not responsible for the delay. If storage fees take your Wallet below zero, you must top up the shortfall within 14 days, and any negative balance is a debt you owe us.

10.6 Our fees exclude any VAT, GST, sales tax or similar tax unless the Fee Schedule says otherwise. Where such tax applies, we will add it to our fees at the applicable rate. You are responsible for all taxes on your sales of the Goods.

10.7 You must raise any dispute about a fee through the Platform within 30 days after the fee is deducted. We will review the dispute in good faith and credit your Wallet with any amount charged in error.

10.8 When a Wallet is closed, we will refund the remaining top-up balance to your original payment method, after deducting all amounts you owe us. Any part of the balance that represents compensation credit under section 12 is not paid out in cash.

## 11. Title and risk

11.1 Title to the Goods remains with you at all times. We do not acquire ownership of the Goods, except to the extent that we sell or dispose of them under section 11.4 or section 18.6.

11.2 While Goods are in our custody, from the time we sign for them until they are delivered to a Recipient or returned to you, we will take reasonable care of them. Otherwise the Goods remain at your risk, subject to our responsibility to provide compensation under section 12.

11.3 You must insure the Goods for their full value against loss and damage while they are in storage and in transit. Compensation under section 12 is limited and is not a substitute for insurance.

11.4 If you do not pay amounts due under this agreement, we may, after giving you 14 days' written notice, hold the Goods until those amounts are paid. If they remain unpaid 30 days after a further written notice, we may sell or otherwise dispose of enough of the Goods to cover the amount owed and our reasonable costs, to the extent permitted by ${governingLaw}, and we will account to you for any surplus.

## 12. Loss and damage claims

12.1 You may make a Claim through the Platform if Goods are lost or damaged while in our custody, or while being delivered to a Recipient by a carrier we arranged.

12.2 Claims must be made within these time limits:
- for Goods missing or damaged on receipt, within the 7-day dispute period in section 6.4;
- for Goods lost or damaged in storage, within 30 days after you became aware, or should reasonably have become aware, of the loss or damage, and in any case within 60 days after the stock report showing the discrepancy was available on the Platform; and
- for Orders lost or damaged in delivery, within 30 days after the expected delivery date.

12.3 Claims made outside these time limits will not be accepted. Each Claim must include the relevant references and supporting evidence, such as photographs and invoices proving the Declared Cost Value.

12.4 We will assess each Claim, which may include stock counts, record checks and carrier enquiries. We aim to decide within 30 days and will give you our decision, with reasons, on the Platform. You may ask for one review within 14 days if you have new evidence.

12.5 If we accept a Claim, compensation is given only as credit to the Wallet for the Storage Country concerned and is never paid in cash. For each affected unit, compensation is the lower of the Declared Cost Value and the per-unit compensation cap in the Fee Schedule for that Storage Country. We will also credit any fulfilment and shipping fees charged for an affected Order.

12.6 We will not give compensation for loss or damage:
- caused by inadequate packaging or labelling by you or your supplier;
- caused by an inherent defect, natural deterioration, expiry or the perishable nature of the Goods;
- to Prohibited Goods, or restricted goods sent without our approval;
- to Goods delivered to an incorrect address that you provided;
- limited to outer packaging that does not affect the saleability of the product;
- caused by an event described in section 21.1; or
- consisting of lost profit, lost sales, loss of goodwill or any other indirect loss.

12.7 If Goods for which we have given compensation are later found, we will return them to your stock and deduct the compensation from your Wallet.

12.8 Subject to section 15.1, this section 12 sets out your only remedy for loss of or damage to the Goods.

## 13. Seller warranties

13.1 You warrant that:
- you own the Goods or have the right to sell them, and no one else has a claim over them that would prevent us from dealing with them under this agreement;
- the Goods are genuine and do not infringe anyone's intellectual property rights;
- the Goods and their labelling and packaging comply with the laws of each Storage Country, including product safety rules;
- all information you give us in your Account, Inbound Shipments and Orders is accurate and complete;
- you hold every licence, registration and approval needed to sell the Goods in each Storage Country; and
- you comply with all anti-bribery, anti-money laundering and sanctions laws that apply to you.

13.2 You are responsible for the safety of the Goods. If any Goods are subject to a recall or safety warning, you must tell us immediately, and we will quarantine or deal with them in line with your instructions, at your cost.

13.3 You are responsible for all customer service to your own buyers, including questions, complaints, refunds, warranties and their rights under ${consumerLaw}. We will not contact your buyers except as needed to deliver an Order or process a return.

13.4 You will indemnify us against all claims, losses, fines and reasonable costs we incur because of a breach of your warranties, Prohibited Goods you sent us, or any claim that the Goods are unsafe, defective or infringing.

## 14. Subcontractors

14.1 We may use Subcontractors to perform any part of the Services, including operating storage facilities, handling Goods and delivering Orders.

14.2 We remain responsible to you for the Services performed by our Subcontractors as if we had performed them ourselves, subject to the limits in this agreement.

14.3 We require every Subcontractor that handles Goods or Recipient Data to meet our standards for security, care and confidentiality. You must give all instructions to us through the Platform, not to our Subcontractors.

## 15. Liability

15.1 Nothing in this agreement limits or excludes either party's liability for death or personal injury caused by negligence, for fraud or fraudulent misrepresentation, or for any other liability that cannot be limited or excluded under ${governingLaw}.

15.2 Subject to section 15.1, neither of us is liable to the other for any loss of profit, revenue, business, goodwill or anticipated savings, or for any indirect or consequential loss, however it arises.

15.3 Subject to section 15.1, our total liability arising under or in connection with this agreement, whether in contract, tort (including negligence) or otherwise, is limited to the total fees you paid us under this agreement in the 12 months before the event giving rise to the claim. Compensation credited under section 12 counts towards this limit.

15.4 We are not liable for any failure or delay to the extent it is caused by your breach of this agreement, by inaccurate information you gave us, or by your Wallet not having enough funds.

15.5 Nothing in this agreement limits your obligation to pay our fees or your liability under section 13.4.

## 16. Data protection

16.1 Each of us will comply with ${dataProtection}, and with any other data protection laws that apply to the processing of personal data under this agreement ("data protection laws").

16.2 For Recipient Data, you are the controller and we are your processor. We will process Recipient Data only on your documented instructions, which are this agreement and the Orders and returns you create, unless the law requires otherwise.

16.3 When processing Recipient Data, we will:
- use it only to fulfil Orders, process returns, handle Claims and provide support to you;
- make sure that everyone who processes it is bound by a duty of confidentiality;
- put in place appropriate technical and organisational measures to keep it secure;
- engage Subcontractors and service providers to process it only under written terms that give it equivalent protection, and remain responsible for them;
- help you respond to requests from individuals and meet your obligations on security and breach notification;
- tell you without undue delay after becoming aware of a personal data breach affecting Recipient Data;
- delete or return Recipient Data when the Services end, except where the law requires us to keep it, and except for Order records we need for tax, accounting, claims and legal purposes; and
- give you the information reasonably needed to show we comply with this section, and allow an audit on reasonable notice no more than once a year, unless a regulator requires more or a personal data breach has occurred.

16.4 You give us general authorisation to use Subcontractors and service providers to process Recipient Data. We will give you notice on the Platform of any intended change to them, and you may object on reasonable data protection grounds.

16.5 We will transfer Recipient Data out of its Storage Country only where data protection laws allow it, with the safeguards they require.

16.6 You confirm that you have a lawful basis for sharing Recipient Data with us and that you have given Recipients any information that data protection laws require.

16.7 We are the controller of the personal data we hold about you and your staff in connection with your Account, and we handle it in line with our privacy notice.

## 17. Confidentiality

17.1 Each of us will keep the other's Confidential Information confidential, use it only for this agreement, and disclose it only to staff, advisers and Subcontractors who need it and are bound by similar duties.

17.2 This does not apply to information that is public, already known to the receiving party or independently developed. Either of us may disclose Confidential Information where the law requires it.

17.3 This section continues to apply for 3 years after this agreement ends, and for as long as the information remains a trade secret.

## 18. Suspension and termination

18.1 Either of us may end this agreement for any reason by giving the other at least 30 days' written notice.

18.2 Either of us may end this agreement immediately by written notice if the other commits a serious breach of this agreement which cannot be remedied, or which is not remedied within 14 days after written notice asking for it to be remedied, or if the other becomes insolvent or stops carrying on business.

18.3 We may suspend the Services, or end this agreement immediately, if:
- you send us Prohibited Goods or restricted goods we have not approved;
- we reasonably suspect fraud, money laundering or other unlawful activity connected with your Account;
- you have not paid amounts due within 30 days after they became due;
- your Goods or instructions put our staff, facilities or Subcontractors at risk; or
- a court, regulator or other authority requires us to.

18.4 During a suspension we may stop accepting Inbound Shipments and Orders, but storage fees continue. We will tell you why, unless the law prevents us, and lift the suspension once the reason is resolved.

18.5 When this agreement ends, we will stop accepting new Inbound Shipments and Orders. We will complete Orders already accepted, as long as your Wallet has enough funds. You must pay all amounts due to us.

18.6 You must arrange the removal or collection of all your Goods within 30 days after this agreement ends. Removal fees and storage fees continue to apply until the Goods leave our facilities. If any Goods remain after that period, we will give you written notice asking you to collect them within a further 14 days. If you do not, we may sell, donate, recycle or otherwise dispose of them, use any proceeds to pay the amounts you owe us, and account to you for any surplus, to the extent permitted by law.

18.7 Provisions that by their nature are intended to continue, including sections 10 to 13, 15 to 17, 18.6, 20 and 21, survive the end of this agreement.

## 19. Changes and re-acceptance

19.1 We may update this agreement. We will give you at least 30 days' notice of any material change by email and on the Platform, except for changes required by law or for security, which may take effect sooner.

19.2 For material changes, we may ask you to review and sign the updated agreement on the Platform. If you have not signed it by the date the change takes effect, we may restrict the creation of new Inbound Shipments and Orders until you do. If you do not accept an updated agreement, you may end this agreement under section 18.1.

19.3 Changes to fees are made under section 10.2.

19.4 Any other change to this agreement must be agreed by both of us in writing, which includes agreement through the Platform.

## 20. Electronic signature and records

20.1 When you sign this agreement, we record the name you entered, your Account details and email address, your IP address, the date and time of signing, the version of the agreement, and a SHA-256 fingerprint of the exact text you were shown.

20.2 The fingerprint allows either of us to confirm later that the text of the agreement has not changed since you signed it.

20.3 We keep these records and the signed text while this agreement is in force and afterwards for as long as the law requires or any dispute needs. You can download your signed agreement from the Platform.

20.4 You agree that these records are evidence of your acceptance of this agreement and may be relied on in any proceedings. Where this agreement requires notice or agreement in writing, email and notices through the Platform satisfy that requirement.

## 21. General

21.1 Neither of us is liable for failure or delay caused by events beyond our reasonable control, such as natural disasters, fire, flood, war, civil unrest, epidemics, utility or network failures and acts of government. If such an event prevents performance for more than 30 days, either of us may end this agreement by written notice. Payment obligations are not suspended.

21.2 You may not transfer this agreement without our written consent. We may transfer it to a group company or a buyer of all or part of our business, and will tell you if we do.

21.3 We send notices to the email address on your Account or through the Platform. You send notices to us through the Platform support channel or the email address published on the Platform. Notices are treated as received on the next Business Day.

21.4 This agreement, with the Fee Schedule and the Platform policies it refers to, is the entire agreement between us about the Services and replaces any earlier understandings.

21.5 If any part of this agreement is invalid or unenforceable, the rest continues in force.

21.6 A delay or failure to enforce any right under this agreement is not a waiver of that right.

21.7 Each of us is an independent business. Nothing in this agreement creates a joint venture, agency or employment relationship between us, and neither of us may bind the other.

21.8 No one other than you and us has any right to enforce this agreement.

21.9 If this agreement is translated, the English version prevails.

21.10 This agreement, and any dispute or claim arising out of or in connection with it, is governed by ${governingLaw}. We will both try to resolve any dispute in good faith through discussion for at least 30 days. If it is not resolved, each of us submits to the exclusive jurisdiction of ${courts}, except that either of us may seek urgent interim relief from any court with jurisdiction.`;
}
