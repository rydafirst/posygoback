import type { TaxCadence } from "../../shared";

export interface ChecklistItem {
  title: string;
  authority: string;
  description: string;
  cadence: TaxCadence;
  dueRule: string;
  guidanceUrl?: string;
  firstDueOn?: (today: string) => string;
}

function next31January(today: string): string {
  const year = Number(today.slice(0, 4));
  const thisYear = `${year}-01-31`;
  return today <= thisYear ? thisYear : `${year + 1}-01-31`;
}

const UK: readonly ChecklistItem[] = [
  {
    title: "Confirmation statement",
    authority: "Companies House",
    description: "Confirm the company's details, officers and shareholders are up to date.",
    cadence: "YEARLY",
    dueRule: "Within 14 days of the review date",
    guidanceUrl: "https://www.gov.uk/file-your-confirmation-statement-with-companies-house",
  },
  {
    title: "Annual accounts",
    authority: "Companies House",
    description: "File the company's accounts. First accounts are due 21 months after the company was set up.",
    cadence: "YEARLY",
    dueRule: "9 months after the end of the financial year",
    guidanceUrl: "https://www.gov.uk/annual-accounts",
  },
  {
    title: "Corporation Tax payment",
    authority: "HMRC",
    description: "Pay Corporation Tax on the year's profit.",
    cadence: "YEARLY",
    dueRule: "9 months and 1 day after the end of the accounting period",
    guidanceUrl: "https://www.gov.uk/pay-corporation-tax",
  },
  {
    title: "Company Tax Return",
    authority: "HMRC",
    description: "File the CT600 return with the accounts and tax calculations.",
    cadence: "YEARLY",
    dueRule: "12 months after the end of the accounting period",
    guidanceUrl: "https://www.gov.uk/company-tax-returns",
  },
  {
    title: "VAT return",
    authority: "HMRC",
    description: "Applies once registered for VAT. Registration is required when fees pass £90,000 in any 12 months.",
    cadence: "QUARTERLY",
    dueRule: "1 month and 7 days after the end of each VAT period",
    guidanceUrl: "https://www.gov.uk/vat-returns",
  },
  {
    title: "Digital platform report",
    authority: "HMRC",
    description: "Report sellers' income and details for the last calendar year, and send each seller a copy.",
    cadence: "YEARLY",
    dueRule: "31 January after each calendar year",
    guidanceUrl: "https://www.gov.uk/guidance/reporting-rules-for-digital-platforms",
    firstDueOn: next31January,
  },
  {
    title: "Fulfilment house approval (FHDDS)",
    authority: "HMRC",
    description: "Needed before storing imported goods for sellers established outside the UK.",
    cadence: "ONCE",
    dueRule: "Before storing goods for non-UK sellers",
    guidanceUrl: "https://www.gov.uk/guidance/fulfilment-house-due-diligence-scheme",
  },
];

const ELSEWHERE: readonly ChecklistItem[] = [
  {
    title: "Sales tax registration check",
    authority: "Your tax adviser",
    description: "Check whether the fees charged to sellers here need VAT, GST or sales tax registration, and from what level of sales.",
    cadence: "ONCE",
    dueRule: "Before taking fees from sellers here",
  },
  {
    title: "Seller and partner income reporting check",
    authority: "Your tax adviser",
    description: "Check whether the platform must report what sellers and partners earn here, and the yearly deadline.",
    cadence: "ONCE",
    dueRule: "Before the first full year of trading here",
  },
  {
    title: "Local presence review",
    authority: "Your tax adviser",
    description: "Check whether hubs, staff or offices here make the company taxable here.",
    cadence: "ONCE",
    dueRule: "Before opening a hub or hiring here",
  },
];

export function checklistFor(countryCode: string): readonly ChecklistItem[] {
  return countryCode === "GB" ? UK : ELSEWHERE;
}
