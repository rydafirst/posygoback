import { z } from "zod";

export const TAX_CADENCES = ["ONCE", "MONTHLY", "QUARTERLY", "YEARLY"] as const;
export type TaxCadence = (typeof TAX_CADENCES)[number];

export const TAX_CADENCE_LABELS: Record<TaxCadence, string> = {
  ONCE: "Once",
  MONTHLY: "Every month",
  QUARTERLY: "Every quarter",
  YEARLY: "Every year",
};

export const TAX_REMINDER_DAYS = [30, 7, 1] as const;

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use a date like 2027-01-31");
const optionalText = (max: number) => z.string().trim().max(max).optional();

export const createTaxObligationSchema = z.object({
  title: z.string().trim().min(3).max(120),
  authority: z.string().trim().min(2).max(120),
  description: z.string().trim().min(3).max(1000),
  cadence: z.enum(TAX_CADENCES),
  dueRule: z.string().trim().min(3).max(200),
  guidanceUrl: z.string().trim().url().max(500).optional(),
  owner: optionalText(120),
  firstDueOn: isoDate.optional(),
});
export type CreateTaxObligationInput = z.infer<typeof createTaxObligationSchema>;

export const updateTaxObligationSchema = createTaxObligationSchema
  .omit({ firstDueOn: true })
  .partial()
  .extend({ confirmed: z.boolean().optional(), active: z.boolean().optional() });
export type UpdateTaxObligationInput = z.infer<typeof updateTaxObligationSchema>;

export const scheduleTaxDeadlineSchema = z.object({ dueOn: isoDate });
export type ScheduleTaxDeadlineInput = z.infer<typeof scheduleTaxDeadlineSchema>;

export const fileTaxDeadlineSchema = z.object({ filedOn: isoDate, reference: optionalText(120), note: optionalText(1000) });
export type FileTaxDeadlineInput = z.infer<typeof fileTaxDeadlineSchema>;

export interface TaxDeadlineView {
  id: string;
  obligationId: string;
  obligationTitle: string;
  countryCode: string;
  dueOn: string;
  status: "OPEN" | "FILED";
  filedOn: string | null;
  reference: string | null;
  note: string | null;
  daysLeft: number;
}

export interface TaxObligationView {
  id: string;
  countryCode: string;
  title: string;
  authority: string;
  description: string;
  cadence: TaxCadence;
  dueRule: string;
  guidanceUrl: string | null;
  owner: string | null;
  confirmed: boolean;
  active: boolean;
  next: TaxDeadlineView | null;
  history: TaxDeadlineView[];
}

export interface TaxThresholdView {
  countryCode: string;
  label: string;
  currency: string;
  limitMinor: number;
  last12MonthsMinor: number;
  guidanceUrl: string;
}

export interface TaxCountrySummary {
  countryCode: string;
  countryName: string;
  obligations: number;
  overdue: number;
  dueSoon: number;
  nextDueOn: string | null;
}

export interface TaxOverviewView {
  countries: TaxCountrySummary[];
  upcoming: TaxDeadlineView[];
  thresholds: TaxThresholdView[];
}

export interface TaxCountryView {
  countryCode: string;
  countryName: string;
  obligations: TaxObligationView[];
  threshold: TaxThresholdView | null;
}

export const TAX_THRESHOLDS: Readonly<Record<string, { label: string; limitMinor: number; guidanceUrl: string }>> = {
  GB: { label: "UK VAT registration", limitMinor: 9_000_000, guidanceUrl: "https://www.gov.uk/register-for-vat" },
  CA: { label: "Canadian GST/HST small supplier limit", limitMinor: 3_000_000, guidanceUrl: "https://www.canada.ca/en/revenue-agency/services/tax/businesses/topics/gst-hst-businesses/gst-hst-registration.html" },
};

const CADENCE_MONTHS: Record<Exclude<TaxCadence, "ONCE">, number> = { MONTHLY: 1, QUARTERLY: 3, YEARLY: 12 };

export function nextDueOn(cadence: TaxCadence, dueOn: string): string | null {
  if (cadence === "ONCE") {
    return null;
  }
  const [year, month, day] = dueOn.split("-").map(Number) as [number, number, number];
  const target = new Date(Date.UTC(year, month - 1 + CADENCE_MONTHS[cadence], 1));
  const lastDay = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate();
  target.setUTCDate(Math.min(day, lastDay));
  return target.toISOString().slice(0, 10);
}

export function daysUntil(dueOn: string, today: string): number {
  return Math.round((Date.parse(`${dueOn}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / 86_400_000);
}
