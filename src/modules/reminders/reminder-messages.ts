import type { ReminderSetting } from "../../generated/prisma/client";
import type { EmailMessage } from "../../infrastructure/email/email.port";
import { fillReminder, type ReminderKey } from "../../shared";
import { REMINDER_CATALOGUE, type ReminderDefinition } from "./reminder-catalogue";

export interface ResolvedReminder {
  key: ReminderKey;
  definition: ReminderDefinition;
  enabled: boolean;
  delaysDays: number[];
  subject: string;
  body: string;
  customised: boolean;
  updatedAt: Date | null;
}

export interface ReminderLinks {
  webUrl: string;
  stopUrl: string;
}

export function resolveReminder(key: ReminderKey, setting: ReminderSetting | undefined): ResolvedReminder {
  const definition = REMINDER_CATALOGUE[key];
  return {
    key,
    definition,
    enabled: setting?.enabled ?? false,
    delaysDays: setting?.delaysDays.length ? setting.delaysDays : definition.delaysDays,
    subject: setting?.subject ?? definition.subject,
    body: setting?.body ?? definition.body,
    customised: Boolean(setting?.subject || setting?.body),
    updatedAt: setting?.updatedAt ?? null,
  };
}

export function reminderEmail(reminder: Pick<ResolvedReminder, "key" | "definition" | "subject" | "body">, to: string, name: string, links: ReminderLinks): EmailMessage {
  return {
    to,
    kind: `reminder.${reminder.key.toLowerCase()}`,
    subject: fillReminder(reminder.subject, name),
    text: fillReminder(reminder.body, name),
    action: { label: reminder.definition.actionLabel, url: `${links.webUrl}${reminder.definition.actionPath}` },
    optOut: { question: "Don't want these reminders?", label: "Stop them", url: links.stopUrl },
  };
}
