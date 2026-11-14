export const PLATFORM_NAME = "Posygo";
export const EARNINGS_SCHEDULE_URL = "posygo.com/partners/earnings";
export const EMAIL_SIGN_OFF = `\n\n${PLATFORM_NAME}`;

export const FOUNDER = { name: "Tolulope Olonibua", title: `Founder, ${PLATFORM_NAME} Ltd` } as const;

export const CONTACT = { email: "hello@posygo.com", phone: "+44 7350 162342", whatsapp: "447350162342" } as const;

export const COMPANY = { legalName: "Posygo Ltd", number: "17557238", jurisdiction: "England and Wales", registeredOffice: "Bartle House, 9 Oxford Court, Manchester, M2 3WQ" } as const;

export const COMPANY_DETAILS = `${COMPANY.legalName}, a company registered in ${COMPANY.jurisdiction} with company number ${COMPANY.number}, whose registered office is at ${COMPANY.registeredOffice}`;

export const COMPANY_FOOTER = `${COMPANY.legalName} · Registered in ${COMPANY.jurisdiction} · Company number ${COMPANY.number} · ${COMPANY.registeredOffice}`;
