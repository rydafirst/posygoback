export interface LegalProfile {
  code: string;
  name: string;
  currency: string;
  governingLaw: string;
  courts: string;
  dataProtection: string;
  partnerTax: string;
  consumer?: string;
}

const EU_GDPR = "the EU General Data Protection Regulation (Regulation (EU) 2016/679)";

export const LEGAL_PROFILES: readonly LegalProfile[] = [
  {
    code: "GB",
    name: "the United Kingdom",
    currency: "GBP",
    governingLaw: "the laws of England and Wales",
    courts: "the courts of England and Wales",
    dataProtection: "the UK GDPR and the Data Protection Act 2018",
    partnerTax:
      "You are responsible for registering with HM Revenue & Customs as self-employed or through your own company, paying your own income tax or corporation tax and National Insurance contributions, registering for and charging VAT if you are required to, and holding the right to work in the United Kingdom.",
    consumer: "the Consumer Rights Act 2015 and the Consumer Contracts (Information, Cancellation and Additional Charges) Regulations 2013",
  },
  {
    code: "IE",
    name: "Ireland",
    currency: "EUR",
    governingLaw: "the laws of Ireland",
    courts: "the courts of Ireland",
    dataProtection: `${EU_GDPR} and the Data Protection Act 2018`,
    partnerTax:
      "You are responsible for registering with the Revenue Commissioners as self-employed or through your own company, paying your own income tax, PRSI and Universal Social Charge, registering for and charging VAT if you are required to, and holding permission to work in Ireland.",
    consumer: "the Consumer Rights Act 2022",
  },
  {
    code: "DE",
    name: "Germany",
    currency: "EUR",
    governingLaw: "the laws of the Federal Republic of Germany",
    courts: "the competent courts of Germany",
    dataProtection: `${EU_GDPR} and the Federal Data Protection Act (Bundesdatenschutzgesetz, BDSG)`,
    partnerTax:
      "You are responsible for registering your business activity where required, registering with your local tax office (Finanzamt), paying your own income tax and any trade tax and social insurance contributions, accounting for VAT (Umsatzsteuer) unless an exemption applies to you, and holding the right to work in Germany.",
    consumer: "the consumer protection provisions of the German Civil Code (Bürgerliches Gesetzbuch)",
  },
  {
    code: "FR",
    name: "France",
    currency: "EUR",
    governingLaw: "the laws of France",
    courts: "the competent courts of France",
    dataProtection: `${EU_GDPR} and Law No. 78-17 of 6 January 1978 (Loi Informatique et Libertés)`,
    partnerTax:
      "You are responsible for registering your business activity, including as a micro-entrepreneur where that applies to you, paying your own income tax and social security contributions, accounting for VAT (TVA) unless an exemption applies to you, and holding the right to work in France.",
    consumer: "the French Consumer Code (Code de la consommation)",
  },
  {
    code: "NL",
    name: "the Netherlands",
    currency: "EUR",
    governingLaw: "the laws of the Netherlands",
    courts: "the competent courts of the Netherlands",
    dataProtection: `${EU_GDPR} and the GDPR Implementation Act (Uitvoeringswet AVG, UAVG)`,
    partnerTax:
      "You are responsible for registering with the Netherlands Chamber of Commerce (KVK) where required, paying your own income tax and contributions to the Dutch Tax and Customs Administration (Belastingdienst), accounting for VAT (btw) unless an exemption applies to you, and holding the right to work in the Netherlands.",
    consumer: "the consumer protection provisions of the Dutch Civil Code (Burgerlijk Wetboek)",
  },
  {
    code: "ES",
    name: "Spain",
    currency: "EUR",
    governingLaw: "the laws of Spain",
    courts: "the competent courts of Spain",
    dataProtection: `${EU_GDPR} and Organic Law 3/2018 on the Protection of Personal Data and Guarantee of Digital Rights (LOPDGDD)`,
    partnerTax:
      "You are responsible for registering with the Spanish Tax Agency (Agencia Tributaria) and the Social Security system, including as a self-employed worker (autónomo) where that applies to you, paying your own income tax (IRPF) and social security contributions, accounting for VAT (IVA), and holding the right to work in Spain.",
    consumer: "Royal Legislative Decree 1/2007 on the protection of consumers and users",
  },
  {
    code: "IT",
    name: "Italy",
    currency: "EUR",
    governingLaw: "the laws of Italy",
    courts: "the competent courts of Italy",
    dataProtection: `${EU_GDPR} and Legislative Decree No. 196/2003 (Codice in materia di protezione dei dati personali), as amended`,
    partnerTax:
      "You are responsible for holding a VAT number (partita IVA) where required, paying your own income tax and social security contributions (including to INPS where applicable), accounting for VAT (IVA) unless an exemption applies to you, and holding the right to work in Italy.",
    consumer: "the Italian Consumer Code (Legislative Decree No. 206/2005)",
  },
  {
    code: "US",
    name: "the United States",
    currency: "USD",
    governingLaw: "the laws of the State of Delaware",
    courts: "the state and federal courts located in the State of Delaware",
    dataProtection: "applicable United States federal and state privacy and data protection laws",
    partnerTax:
      "You are responsible for providing us with a completed IRS Form W-9, paying your own federal, state and local income taxes and self-employment taxes, collecting and paying any sales or use taxes that apply to you, and being legally authorized to work in the United States.",
    consumer: "applicable federal and state consumer protection laws",
  },
  {
    code: "CA",
    name: "Canada",
    currency: "CAD",
    governingLaw: "the laws of the Province of Ontario and the federal laws of Canada applicable in Ontario",
    courts: "the courts of the Province of Ontario",
    dataProtection: "the Personal Information Protection and Electronic Documents Act (PIPEDA) and any applicable provincial privacy laws",
    partnerTax:
      "You are responsible for reporting your earnings to the Canada Revenue Agency, paying your own income tax and Canada Pension Plan contributions, registering for and charging GST/HST or provincial sales tax if you are required to, and being legally entitled to work in Canada.",
    consumer: "applicable federal and provincial consumer protection laws",
  },
  {
    code: "MX",
    name: "Mexico",
    currency: "MXN",
    governingLaw: "the federal laws of the United Mexican States",
    courts: "the competent courts of Mexico City",
    dataProtection: "the Federal Law on the Protection of Personal Data Held by Private Parties (LFPDPPP)",
    partnerTax:
      "You are responsible for registering with the Tax Administration Service (SAT) and holding a valid RFC, issuing electronic invoices (CFDI) for your earnings where required, paying your own income tax (ISR) and VAT (IVA) and any social security contributions, and being legally permitted to work in Mexico.",
    consumer: "the Federal Consumer Protection Law (Ley Federal de Protección al Consumidor)",
  },
  {
    code: "BR",
    name: "Brazil",
    currency: "BRL",
    governingLaw: "the laws of the Federative Republic of Brazil",
    courts: "the courts of the City of São Paulo, State of São Paulo",
    dataProtection: "the General Data Protection Law (Lei Geral de Proteção de Dados, Law No. 13,709/2018, LGPD)",
    partnerTax:
      "You are responsible for holding a valid CPF or CNPJ registration, including as an individual micro-entrepreneur (MEI) where that applies to you, issuing invoices (nota fiscal) where required, paying your own income tax, social security (INSS) contributions and any municipal or state taxes, and being legally permitted to work in Brazil.",
    consumer: "the Consumer Defence Code (Law No. 8,078/1990)",
  },
  {
    code: "AU",
    name: "Australia",
    currency: "AUD",
    governingLaw: "the laws of New South Wales",
    courts: "the courts of New South Wales and the courts entitled to hear appeals from them",
    dataProtection: "the Privacy Act 1988 (Cth), including the Australian Privacy Principles",
    partnerTax:
      "You are responsible for holding an Australian Business Number, paying your own income tax to the Australian Taxation Office, registering for and charging GST if you are required to, meeting any superannuation obligations for people you engage, and having the right to work in Australia.",
    consumer: "the Australian Consumer Law in Schedule 2 to the Competition and Consumer Act 2010 (Cth)",
  },
  {
    code: "NZ",
    name: "New Zealand",
    currency: "NZD",
    governingLaw: "the laws of New Zealand",
    courts: "the courts of New Zealand",
    dataProtection: "the Privacy Act 2020",
    partnerTax:
      "You are responsible for paying your own income tax to Inland Revenue, registering for and charging GST if you are required to, paying any ACC levies that apply to you, and being entitled to work in New Zealand.",
    consumer: "the Consumer Guarantees Act 1993 and the Fair Trading Act 1986",
  },
  {
    code: "SG",
    name: "Singapore",
    currency: "SGD",
    governingLaw: "the laws of Singapore",
    courts: "the courts of Singapore",
    dataProtection: "the Personal Data Protection Act 2012 (PDPA)",
    partnerTax:
      "You are responsible for registering your business with ACRA where required, paying your own income tax to the Inland Revenue Authority of Singapore, making any MediSave contributions required of self-employed persons, registering for and charging GST if you are required to, and being lawfully permitted to work or carry on business in Singapore.",
    consumer: "the Consumer Protection (Fair Trading) Act",
  },
  {
    code: "IN",
    name: "India",
    currency: "INR",
    governingLaw: "the laws of India",
    courts: "the competent courts at Mumbai, India",
    dataProtection: "the Digital Personal Data Protection Act 2023 and the Information Technology Act 2000 and the rules made under them",
    partnerTax:
      "You are responsible for holding a valid PAN, paying your own income tax, registering for and charging GST if you are required to, and being legally permitted to work in India. We may deduct tax at source from your earnings where Indian law requires us to, and will give you the related certificates.",
    consumer: "the Consumer Protection Act 2019 and the Consumer Protection (E-Commerce) Rules 2020",
  },
  {
    code: "JP",
    name: "Japan",
    currency: "JPY",
    governingLaw: "the laws of Japan",
    courts: "the Tokyo District Court as the court of first instance",
    dataProtection: "the Act on the Protection of Personal Information (APPI)",
    partnerTax:
      "You are responsible for filing your own tax returns and paying your own income tax and residence tax, accounting for consumption tax if you are required to, registering as a qualified invoice issuer where that applies to you, and holding a status of residence that permits you to carry out this work in Japan.",
    consumer: "the Consumer Contract Act and the Act on Specified Commercial Transactions",
  },
  {
    code: "AE",
    name: "the United Arab Emirates",
    currency: "AED",
    governingLaw: "the laws of the Emirate of Dubai and the federal laws of the United Arab Emirates applicable in Dubai",
    courts: "the courts of the Emirate of Dubai",
    dataProtection: "Federal Decree-Law No. 45 of 2021 on the Protection of Personal Data (PDPL)",
    partnerTax:
      "You are responsible for holding any trade licence required for your activity, registering for UAE Corporate Tax and VAT with the Federal Tax Authority if you are required to, paying any tax due on your earnings, and holding a valid residence and work status that permits you to carry out this work in the United Arab Emirates.",
    consumer: "Federal Law No. 15 of 2020 on Consumer Protection",
  },
  {
    code: "NG",
    name: "Nigeria",
    currency: "NGN",
    governingLaw: "the laws of the Federal Republic of Nigeria",
    courts: "the courts of Lagos State, Nigeria",
    dataProtection: "the Nigeria Data Protection Act 2023",
    partnerTax:
      "You are responsible for holding a valid Tax Identification Number, registering with the relevant tax authorities, paying your own personal income tax or company income tax, charging VAT if you are required to, and being legally permitted to work in Nigeria.",
    consumer: "the Federal Competition and Consumer Protection Act 2018",
  },
  {
    code: "GH",
    name: "Ghana",
    currency: "GHS",
    governingLaw: "the laws of the Republic of Ghana",
    courts: "the courts of Ghana",
    dataProtection: "the Data Protection Act 2012 (Act 843)",
    partnerTax:
      "You are responsible for holding a valid Taxpayer Identification Number, paying your own income tax to the Ghana Revenue Authority, registering for and charging VAT if you are required to, and being legally permitted to work in Ghana.",
  },
  {
    code: "KE",
    name: "Kenya",
    currency: "KES",
    governingLaw: "the laws of Kenya",
    courts: "the courts of Kenya",
    dataProtection: "the Data Protection Act 2019",
    partnerTax:
      "You are responsible for holding a valid KRA PIN, paying your own income tax to the Kenya Revenue Authority, registering for and charging VAT if you are required to, and being legally permitted to work in Kenya.",
    consumer: "the Consumer Protection Act 2012",
  },
  {
    code: "ZA",
    name: "South Africa",
    currency: "ZAR",
    governingLaw: "the laws of the Republic of South Africa",
    courts: "the courts of the Republic of South Africa",
    dataProtection: "the Protection of Personal Information Act 4 of 2013 (POPIA)",
    partnerTax:
      "You are responsible for registering with the South African Revenue Service, paying your own income tax including any provisional tax, registering for and charging VAT if you are required to, and being legally permitted to work in South Africa.",
    consumer: "the Consumer Protection Act 68 of 2008 and the Electronic Communications and Transactions Act 25 of 2002",
  },
];

export function legalProfileFor(code: string): LegalProfile | undefined {
  const normalised = code.trim().toUpperCase();
  return LEGAL_PROFILES.find((profile) => profile.code === normalised);
}
