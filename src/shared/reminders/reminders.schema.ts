import { z } from "zod";

export const REMINDER_KEYS = [
  "SELLER_CONFIRM_EMAIL",
  "SELLER_VERIFY_BUSINESS",
  "SELLER_ACTIVATION_FEE",
  "SELLER_FIRST_PRODUCT",
  "SELLER_FIRST_SHIPMENT",
  "SELLER_QUIET",
  "PARTNER_SEND_FOR_REVIEW",
  "PARTNER_PAYOUTS",
] as const;
export type ReminderKey = (typeof REMINDER_KEYS)[number];

export const REMINDER_AUDIENCES = ["SELLER", "PARTNER"] as const;
export type ReminderAudience = (typeof REMINDER_AUDIENCES)[number];

export const REMINDER_NAME = "{name}";

export const REMINDER_LIMITS = { maxSteps: 3, minDays: 1, maxDays: 120, gapDays: 3 } as const;

const delays = z
  .array(z.number().int().min(REMINDER_LIMITS.minDays).max(REMINDER_LIMITS.maxDays))
  .min(1)
  .max(REMINDER_LIMITS.maxSteps)
  .refine((days) => days.every((day, index) => index === 0 || day > days[index - 1]!), "Each reminder must come later than the one before");

export const reminderKeySchema = z.enum(REMINDER_KEYS);

export const reminderTemplateSchema = z.object({
  subject: z.string().trim().min(3).max(120),
  body: z.string().trim().min(20).max(2000),
});
export type ReminderTemplateInput = z.infer<typeof reminderTemplateSchema>;

export const updateReminderSchema = reminderTemplateSchema.extend({
  enabled: z.boolean(),
  delaysDays: delays,
});
export type UpdateReminderInput = z.infer<typeof updateReminderSchema>;

export interface ReminderResultsView {
  sent: number;
  completed: number;
}

export interface ReminderView {
  key: ReminderKey;
  audience: ReminderAudience;
  title: string;
  trigger: string;
  actionLabel: string;
  enabled: boolean;
  delaysDays: number[];
  subject: string;
  body: string;
  customised: boolean;
  waiting: number;
  last30Days: ReminderResultsView;
  updatedAt: string | null;
}

export interface ReminderPreviewView {
  subject: string;
  text: string;
  actionLabel: string;
}

export function fillReminder(template: string, name: string): string {
  return template.replaceAll(REMINDER_NAME, name);
}
