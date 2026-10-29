import { Injectable } from "@nestjs/common";

import { PrismaService } from "../../database/prisma.service";
import { daysUntil, TAX_REMINDER_DAYS } from "../../shared";
import { StaffAlertsService } from "../notifications/staff-alerts.service";
import { dayOf, isoDay } from "./tax-dates";

const FURTHEST_MS = Math.max(...TAX_REMINDER_DAYS) * 24 * 60 * 60 * 1000;

export function reminderStep(daysLeft: number, remindedDays: number | null): number | null {
  const step = [...TAX_REMINDER_DAYS].sort((a, b) => a - b).find((days) => daysLeft <= days);
  return step !== undefined && (remindedDays === null || remindedDays > step) ? step : null;
}

function when(daysLeft: number): string {
  if (daysLeft < 0) {
    return `overdue by ${-daysLeft} ${-daysLeft === 1 ? "day" : "days"}`;
  }
  if (daysLeft === 0) {
    return "due today";
  }
  return `due in ${daysLeft} ${daysLeft === 1 ? "day" : "days"}`;
}

@Injectable()
export class TaxRemindersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly alerts: StaffAlertsService,
  ) {}

  async send(on: string): Promise<number> {
    const due = await this.prisma.taxDeadline.findMany({
      where: { status: "OPEN", dueOn: { lte: new Date(dayOf(on).getTime() + FURTHEST_MS) }, obligation: { active: true } },
      include: { obligation: { select: { title: true, countryCode: true, authority: true } } },
    });
    let sent = 0;
    for (const deadline of due) {
      const daysLeft = daysUntil(isoDay(deadline.dueOn), on);
      const overdue = daysLeft < 0;
      const step = overdue ? null : reminderStep(daysLeft, deadline.remindedDays);
      if (overdue ? deadline.remindedOn && isoDay(deadline.remindedOn) === on : step === null) {
        continue;
      }
      const claimed = await this.prisma.taxDeadline.updateMany({
        where: { id: deadline.id, status: "OPEN", remindedDays: deadline.remindedDays, remindedOn: deadline.remindedOn },
        data: { remindedOn: dayOf(on), ...(step === null ? {} : { remindedDays: step }) },
      });
      if (claimed.count === 0) {
        continue;
      }
      const { title, countryCode, authority } = deadline.obligation;
      await this.alerts.raise("taxDeadlines", {
        countryCode,
        title: `${title} (${countryCode}) is ${when(daysLeft)}`,
        body: `${title} for ${authority} is ${when(daysLeft)}, on ${isoDay(deadline.dueOn)}. Mark it as filed once it's done.`,
        href: `/admin/tax/${countryCode}`,
      });
      sent += 1;
    }
    return sent;
  }
}
