import { z } from "zod";

export const SUPPORT_CASE_KINDS = ["ERROR", "QUESTION"] as const;
export type SupportCaseKind = (typeof SUPPORT_CASE_KINDS)[number];

export const SUPPORT_CASE_STATUSES = ["OPEN", "RESOLVED"] as const;
export type SupportCaseStatus = (typeof SUPPORT_CASE_STATUSES)[number];

export const SUPPORT_TRAIL_LIMIT = 20;

const CARD_LIKE = /\d[\d -]{10,}\d/g;

export function scrubSensitive(text: string): string {
  return text.replace(CARD_LIKE, "[number removed]");
}

const pagePath = z
  .string()
  .trim()
  .min(1)
  .max(300)
  .regex(/^\/[^\s?#]*$/, "Use the page path only");

export const supportReportSchema = z
  .object({
    kind: z.enum(SUPPORT_CASE_KINDS),
    page: pagePath,
    message: z.string().trim().max(1000).default(""),
    contactEmail: z.string().trim().toLowerCase().email().max(254).optional(),
    error: z
      .object({
        code: z
          .string()
          .max(60)
          .regex(/^[a-z_]+$/),
        status: z.number().int().min(0).max(599),
        endpoint: z
          .string()
          .max(200)
          .regex(/^\/v1\/[^\s?#]*$/),
        correlationId: z.string().uuid().optional(),
      })
      .optional(),
    trail: z
      .array(z.object({ at: z.string().datetime(), what: z.string().trim().min(1).max(160) }))
      .max(SUPPORT_TRAIL_LIMIT)
      .default([]),
  })
  .refine((report) => report.kind !== "ERROR" || report.error !== undefined, { message: "Describe the error", path: ["error"] })
  .refine((report) => report.kind !== "QUESTION" || report.message.length >= 5, { message: "Tell us a little about what you need", path: ["message"] });
export type SupportReportInput = z.input<typeof supportReportSchema>;
export type SupportReport = z.output<typeof supportReportSchema>;

export const resolveSupportCaseSchema = z.object({ note: z.string().trim().min(5).max(500) });
export type ResolveSupportCaseInput = z.infer<typeof resolveSupportCaseSchema>;

export interface SupportReportResult {
  reference: string;
  alreadyKnown: boolean;
}

export interface SupportCaseView {
  id: string;
  reference: string;
  kind: SupportCaseKind;
  status: SupportCaseStatus;
  page: string;
  errorCode: string | null;
  errorStatus: number | null;
  endpoint: string | null;
  reports: number;
  firstSeenAt: string;
  lastSeenAt: string;
  resolvedAt: string | null;
  resolutionNote: string | null;
}

export interface SupportReportView {
  id: string;
  at: string;
  message: string;
  correlationId: string | null;
  trail: Array<{ at: string; what: string }>;
  userAgent: string | null;
  reporter: { email: string | null; role: string | null; business: string | null };
}

export interface SupportCaseDetailView extends SupportCaseView {
  reportDetails: SupportReportView[];
}
