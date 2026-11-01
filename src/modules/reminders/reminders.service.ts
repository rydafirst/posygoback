import { Inject, Injectable } from "@nestjs/common";

import { APP_CONFIG } from "../../config/config.module";
import type { AppConfig } from "../../config/config.schema";
import { PrismaService } from "../../database/prisma.service";
import { Prisma } from "../../generated/prisma/client";
import { EMAIL_SENDER, type EmailSender } from "../../infrastructure/email/email.port";
import { REMINDER_KEYS, REMINDER_LIMITS } from "../../shared";
import { type ReminderCandidate, ReminderAudiencesService } from "./reminder-audiences.service";
import { reminderEmail, type ResolvedReminder, resolveReminder } from "./reminder-messages";
import { ReminderOptOutsService } from "./reminder-opt-outs.service";

const DAY_MS = 24 * 60 * 60 * 1000;
const STALE_AFTER_DAYS = 30;

export function nextReminderStep(delaysDays: readonly number[], since: Date, stepsSent: number, now: Date): number | null {
  const delay = delaysDays[stepsSent];
  if (delay === undefined) {
    return null;
  }
  const lastDelay = delaysDays[delaysDays.length - 1]!;
  const age = now.getTime() - since.getTime();
  return age >= delay * DAY_MS && age <= (lastDelay + STALE_AFTER_DAYS) * DAY_MS ? stepsSent : null;
}

@Injectable()
export class RemindersService {
  constructor(
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    @Inject(EMAIL_SENDER) private readonly email: EmailSender,
    private readonly prisma: PrismaService,
    private readonly audiences: ReminderAudiencesService,
    private readonly optOuts: ReminderOptOutsService,
  ) {}

  async settings(): Promise<ResolvedReminder[]> {
    const rows = await this.prisma.reminderSetting.findMany();
    return REMINDER_KEYS.map((key) => resolveReminder(key, rows.find((row) => row.key === key)));
  }

  async run(now: Date): Promise<number> {
    const stopped = await this.optOuts.stopped();
    const recent = new Set(
      (await this.prisma.reminderSend.findMany({ where: { sentAt: { gte: new Date(now.getTime() - REMINDER_LIMITS.gapDays * DAY_MS) } }, select: { email: true } })).map((send) => send.email),
    );
    let sent = 0;
    for (const reminder of await this.settings()) {
      if (!reminder.enabled) {
        continue;
      }
      const candidates = await this.audiences.find(reminder.key, now);
      await this.markCompleted(reminder, candidates, now);
      for (const candidate of candidates) {
        const address = candidate.email.toLowerCase();
        if (stopped.has(address) || recent.has(address)) {
          continue;
        }
        if (await this.sendNext(reminder, candidate, address, now)) {
          recent.add(address);
          sent += 1;
        }
      }
    }
    return sent;
  }

  private async markCompleted(reminder: ResolvedReminder, candidates: readonly ReminderCandidate[], now: Date): Promise<void> {
    await this.prisma.reminderSend.updateMany({
      where: { key: reminder.key, completedAt: null, subjectId: { notIn: candidates.map((candidate) => candidate.subjectId) } },
      data: { completedAt: now },
    });
  }

  private async sendNext(reminder: ResolvedReminder, candidate: ReminderCandidate, address: string, now: Date): Promise<boolean> {
    const stepsSent = await this.prisma.reminderSend.count({ where: { key: reminder.key, subjectId: candidate.subjectId, episodeAt: candidate.since } });
    const step = nextReminderStep(reminder.delaysDays, candidate.since, stepsSent, now);
    if (step === null) {
      return false;
    }
    try {
      await this.prisma.reminderSend.create({ data: { key: reminder.key, subjectId: candidate.subjectId, email: address, episodeAt: candidate.since, step, sentAt: now } });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
        return false;
      }
      throw error;
    }
    await this.email.send(reminderEmail(reminder, candidate.email, candidate.name, { webUrl: this.config.WEB_PUBLIC_URL, stopUrl: this.optOuts.stopUrl(address) }));
    return true;
  }
}
