import { daysUntil, type TaxDeadlineView, type TaxObligationView } from "../../shared";
import type { TaxDeadline, TaxObligation } from "../../generated/prisma/client";
import { isoDay } from "./tax-dates";

type DeadlineWithObligation = TaxDeadline & { obligation: Pick<TaxObligation, "title" | "countryCode"> };

export function deadlineView(deadline: DeadlineWithObligation, on: string): TaxDeadlineView {
  const dueOn = isoDay(deadline.dueOn);
  return {
    id: deadline.id,
    obligationId: deadline.obligationId,
    obligationTitle: deadline.obligation.title,
    countryCode: deadline.obligation.countryCode,
    dueOn,
    status: deadline.status,
    filedOn: deadline.filedOn ? isoDay(deadline.filedOn) : null,
    reference: deadline.reference,
    note: deadline.note,
    daysLeft: daysUntil(dueOn, on),
  };
}

export function obligationView(obligation: TaxObligation & { deadlines: TaxDeadline[] }, on: string): TaxObligationView {
  const deadlines = obligation.deadlines.map((deadline) => deadlineView({ ...deadline, obligation }, on));
  return {
    id: obligation.id,
    countryCode: obligation.countryCode,
    title: obligation.title,
    authority: obligation.authority,
    description: obligation.description,
    cadence: obligation.cadence,
    dueRule: obligation.dueRule,
    guidanceUrl: obligation.guidanceUrl,
    owner: obligation.owner,
    confirmed: obligation.confirmed,
    active: obligation.active,
    next: deadlines.find((deadline) => deadline.status === "OPEN") ?? null,
    history: deadlines.filter((deadline) => deadline.status === "FILED").sort((a, b) => b.dueOn.localeCompare(a.dueOn)),
  };
}
