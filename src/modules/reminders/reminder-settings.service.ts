import { Inject, Injectable } from "@nestjs/common";

import type { AuthPrincipal, RequestMeta } from "../../common/auth/auth-principal";
import { APP_CONFIG } from "../../config/config.module";
import type { AppConfig } from "../../config/config.schema";
import { PrismaService } from "../../database/prisma.service";
import { AuditService } from "../../infrastructure/audit/audit.service";
import { EMAIL_SENDER, type EmailSender } from "../../infrastructure/email/email.port";
import type { ReminderKey, ReminderPreviewView, ReminderTemplateInput, ReminderView, UpdateReminderInput } from "../../shared";
import { ReminderAudiencesService } from "./reminder-audiences.service";
import { REMINDER_CATALOGUE } from "./reminder-catalogue";
import { reminderEmail, type ResolvedReminder } from "./reminder-messages";
import { ReminderOptOutsService } from "./reminder-opt-outs.service";
import { RemindersService } from "./reminders.service";

const DAY_MS = 24 * 60 * 60 * 1000;
const SAMPLE_NAME = { SELLER: "Ada's Atelier", PARTNER: "Ada" } as const;

@Injectable()
export class ReminderSettingsService {
  constructor(
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    @Inject(EMAIL_SENDER) private readonly email: EmailSender,
    private readonly prisma: PrismaService,
    private readonly reminders: RemindersService,
    private readonly audiences: ReminderAudiencesService,
    private readonly optOuts: ReminderOptOutsService,
    private readonly audit: AuditService,
  ) {}

  async list(now = new Date()): Promise<ReminderView[]> {
    const since = new Date(now.getTime() - 30 * DAY_MS);
    const [settings, sent, completed] = await Promise.all([
      this.reminders.settings(),
      this.prisma.reminderSend.groupBy({ by: ["key"], where: { sentAt: { gte: since } }, _count: { _all: true } }),
      this.prisma.reminderSend.groupBy({ by: ["key"], where: { sentAt: { gte: since }, completedAt: { not: null } }, _count: { _all: true } }),
    ]);
    const count = (rows: typeof sent, key: ReminderKey) => rows.find((row) => row.key === key)?._count._all ?? 0;
    return Promise.all(
      settings.map(async (reminder) => ({
        key: reminder.key,
        audience: reminder.definition.audience,
        title: reminder.definition.title,
        trigger: reminder.definition.trigger,
        actionLabel: reminder.definition.actionLabel,
        enabled: reminder.enabled,
        delaysDays: reminder.delaysDays,
        subject: reminder.subject,
        body: reminder.body,
        customised: reminder.customised,
        waiting: (await this.audiences.find(reminder.key, now)).length,
        last30Days: { sent: count(sent, reminder.key), completed: count(completed, reminder.key) },
        updatedAt: reminder.updatedAt?.toISOString() ?? null,
      })),
    );
  }

  async update(principal: AuthPrincipal, key: ReminderKey, input: UpdateReminderInput, meta: RequestMeta): Promise<ReminderView> {
    const definition = REMINDER_CATALOGUE[key];
    const data = {
      enabled: input.enabled,
      delaysDays: input.delaysDays,
      subject: input.subject === definition.subject ? null : input.subject,
      body: input.body === definition.body ? null : input.body,
      updatedBy: principal.userId,
    };
    await this.prisma.reminderSetting.upsert({ where: { key }, create: { key, ...data }, update: data });
    await this.audit.record({ actor: { userId: principal.userId, role: principal.role }, action: "reminders.updated", resourceType: "reminder", resourceId: null, after: { key, enabled: input.enabled, delaysDays: input.delaysDays }, meta });
    return (await this.list()).find((reminder) => reminder.key === key)!;
  }

  async reset(principal: AuthPrincipal, key: ReminderKey, meta: RequestMeta): Promise<ReminderView> {
    await this.prisma.reminderSetting.updateMany({ where: { key }, data: { subject: null, body: null, delaysDays: [], updatedBy: principal.userId } });
    await this.audit.record({ actor: { userId: principal.userId, role: principal.role }, action: "reminders.reset", resourceType: "reminder", resourceId: null, after: { key }, meta });
    return (await this.list()).find((reminder) => reminder.key === key)!;
  }

  preview(key: ReminderKey, template: ReminderTemplateInput): ReminderPreviewView {
    const message = this.sample(key, template, "preview@posygo.com");
    return { subject: message.subject, text: message.text, actionLabel: message.action!.label };
  }

  async sendTest(principal: AuthPrincipal, key: ReminderKey, template: ReminderTemplateInput): Promise<{ to: string }> {
    const { email } = await this.prisma.user.findUniqueOrThrow({ where: { id: principal.userId }, select: { email: true } });
    const message = this.sample(key, template, email);
    await this.email.send({ ...message, kind: "reminder.test", subject: `[Test] ${message.subject}` });
    return { to: email };
  }

  private sample(key: ReminderKey, template: ReminderTemplateInput, to: string) {
    const definition = REMINDER_CATALOGUE[key];
    const reminder: Pick<ResolvedReminder, "key" | "definition" | "subject" | "body"> = { key, definition, subject: template.subject, body: template.body };
    return reminderEmail(reminder, to, SAMPLE_NAME[definition.audience], { webUrl: this.config.WEB_PUBLIC_URL, stopUrl: this.optOuts.stopUrl(to) });
  }
}
