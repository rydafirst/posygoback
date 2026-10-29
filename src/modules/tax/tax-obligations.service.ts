import { Injectable } from "@nestjs/common";

import type { AuthPrincipal, RequestMeta } from "../../common/auth/auth-principal";
import { Errors } from "../../common/http/app-exception";
import { type DatabaseClient, isUniqueViolation, PrismaService } from "../../database/prisma.service";
import { AuditService } from "../../infrastructure/audit/audit.service";
import {
  type CreateTaxObligationInput,
  type FileTaxDeadlineInput,
  nextDueOn,
  type ScheduleTaxDeadlineInput,
  type TaxCountrySummary,
  type TaxCountryView,
  type TaxObligationView,
  type TaxOverviewView,
  type UpdateTaxObligationInput,
} from "../../shared";
import { checklistFor } from "./tax-checklists";
import { dayOf, isoDay, today } from "./tax-dates";
import { TaxThresholdsService } from "./tax-thresholds.service";
import { deadlineView, obligationView } from "./tax-views";

const UPCOMING_DAYS = 90;
const SOON_DAYS = 30;

@Injectable()
export class TaxObligationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly thresholds: TaxThresholdsService,
  ) {}

  async overview(): Promise<TaxOverviewView> {
    const on = today();
    const [countries, open, thresholds] = await Promise.all([
      this.prisma.country.findMany({ select: { code: true, name: true, _count: { select: { taxObligations: { where: { active: true } } } } }, orderBy: { name: "asc" } }),
      this.prisma.taxDeadline.findMany({
        where: { status: "OPEN", obligation: { active: true } },
        include: { obligation: { select: { title: true, countryCode: true } } },
        orderBy: { dueOn: "asc" },
      }),
      this.thresholds.all(),
    ]);
    const deadlines = open.map((deadline) => deadlineView(deadline, on));
    const summaries: TaxCountrySummary[] = countries.map((country) => {
      const mine = deadlines.filter((deadline) => deadline.countryCode === country.code);
      return {
        countryCode: country.code,
        countryName: country.name,
        obligations: country._count.taxObligations,
        overdue: mine.filter((deadline) => deadline.daysLeft < 0).length,
        dueSoon: mine.filter((deadline) => deadline.daysLeft >= 0 && deadline.daysLeft <= SOON_DAYS).length,
        nextDueOn: mine[0]?.dueOn ?? null,
      };
    });
    return { countries: summaries, upcoming: deadlines.filter((deadline) => deadline.daysLeft <= UPCOMING_DAYS), thresholds };
  }

  async country(countryCode: string): Promise<TaxCountryView> {
    const country = await this.prisma.country.findUnique({ where: { code: countryCode }, select: { code: true, name: true } });
    if (!country) {
      throw Errors.notFound();
    }
    const on = today();
    const [obligations, threshold] = await Promise.all([
      this.prisma.taxObligation.findMany({ where: { countryCode }, include: { deadlines: true }, orderBy: [{ active: "desc" }, { createdAt: "asc" }] }),
      this.thresholds.forCountry(countryCode),
    ]);
    return { countryCode: country.code, countryName: country.name, obligations: obligations.map((obligation) => obligationView(obligation, on)), threshold };
  }

  async applyChecklist(principal: AuthPrincipal, countryCode: string, meta: RequestMeta): Promise<TaxCountryView> {
    await this.requireCountry(countryCode);
    const on = today();
    await this.prisma.$transaction(async (tx) => {
      if ((await tx.taxObligation.count({ where: { countryCode } })) > 0) {
        throw Errors.invalidTransition("This country already has obligations.");
      }
      for (const item of checklistFor(countryCode)) {
        const { firstDueOn, ...fields } = item;
        await this.insert(tx, principal, countryCode, { ...fields, firstDueOn: firstDueOn?.(on) });
      }
      await this.audit.record({ actor: this.actor(principal), action: "tax.checklist_added", resourceType: "country", resourceId: countryCode, countryCode, meta }, tx);
    });
    return this.country(countryCode);
  }

  async create(principal: AuthPrincipal, countryCode: string, input: CreateTaxObligationInput, meta: RequestMeta): Promise<TaxObligationView> {
    await this.requireCountry(countryCode);
    const id = await this.prisma.$transaction(async (tx) => {
      const created = await this.insert(tx, principal, countryCode, input);
      await this.audit.record({ actor: this.actor(principal), action: "tax.obligation_added", resourceType: "tax_obligation", resourceId: created, countryCode, after: input, meta }, tx);
      return created;
    });
    return this.obligation(id);
  }

  async update(principal: AuthPrincipal, id: string, input: UpdateTaxObligationInput, meta: RequestMeta): Promise<TaxObligationView> {
    const before = await this.prisma.taxObligation.findUnique({ where: { id } });
    if (!before) {
      throw Errors.notFound();
    }
    await this.prisma.$transaction(async (tx) => {
      await tx.taxObligation.update({ where: { id }, data: input });
      await this.audit.record({ actor: this.actor(principal), action: "tax.obligation_updated", resourceType: "tax_obligation", resourceId: id, countryCode: before.countryCode, before, after: input, meta }, tx);
    });
    return this.obligation(id);
  }

  async schedule(principal: AuthPrincipal, obligationId: string, input: ScheduleTaxDeadlineInput, meta: RequestMeta): Promise<TaxObligationView> {
    const obligation = await this.prisma.taxObligation.findUnique({ where: { id: obligationId }, include: { deadlines: { where: { status: "OPEN" }, select: { id: true } } } });
    if (!obligation) {
      throw Errors.notFound();
    }
    if (obligation.deadlines.length > 0) {
      throw Errors.invalidTransition("This already has a due date. Change that date instead.");
    }
    await this.prisma.$transaction(async (tx) => {
      const deadline = await this.addDeadline(tx, obligationId, input.dueOn);
      await this.audit.record({ actor: this.actor(principal), action: "tax.deadline_set", resourceType: "tax_deadline", resourceId: deadline, countryCode: obligation.countryCode, after: input, meta }, tx);
    });
    return this.obligation(obligationId);
  }

  async move(principal: AuthPrincipal, deadlineId: string, input: ScheduleTaxDeadlineInput, meta: RequestMeta): Promise<TaxObligationView> {
    const deadline = await this.openDeadline(deadlineId);
    await this.prisma.$transaction(async (tx) => {
      await tx.taxDeadline.update({ where: { id: deadlineId }, data: { dueOn: dayOf(input.dueOn), remindedDays: null, remindedOn: null } }).catch(this.sameDay);
      await this.audit.record(
        { actor: this.actor(principal), action: "tax.deadline_moved", resourceType: "tax_deadline", resourceId: deadlineId, countryCode: deadline.obligation.countryCode, before: { dueOn: isoDay(deadline.dueOn) }, after: input, meta },
        tx,
      );
    });
    return this.obligation(deadline.obligationId);
  }

  async file(principal: AuthPrincipal, deadlineId: string, input: FileTaxDeadlineInput, meta: RequestMeta): Promise<TaxObligationView> {
    const deadline = await this.openDeadline(deadlineId);
    const { obligation } = deadline;
    await this.prisma.$transaction(async (tx) => {
      const filed = await tx.taxDeadline.updateMany({
        where: { id: deadlineId, status: "OPEN" },
        data: { status: "FILED", filedOn: dayOf(input.filedOn), reference: input.reference ?? null, note: input.note ?? null, filedBy: principal.userId },
      });
      if (filed.count === 0) {
        throw Errors.invalidTransition("This has already been marked as filed.");
      }
      const following = obligation.active ? nextDueOn(obligation.cadence, isoDay(deadline.dueOn)) : null;
      if (following) {
        await this.addDeadline(tx, obligation.id, following);
      }
      await this.audit.record(
        { actor: this.actor(principal), action: "tax.deadline_filed", resourceType: "tax_deadline", resourceId: deadlineId, countryCode: obligation.countryCode, after: { ...input, nextDueOn: following }, meta },
        tx,
      );
    });
    return this.obligation(obligation.id);
  }

  private async insert(tx: DatabaseClient, principal: AuthPrincipal, countryCode: string, input: CreateTaxObligationInput): Promise<string> {
    const { firstDueOn, ...fields } = input;
    const created = await tx.taxObligation.create({ data: { ...fields, countryCode, createdBy: principal.userId }, select: { id: true } });
    if (firstDueOn) {
      await this.addDeadline(tx, created.id, firstDueOn);
    }
    return created.id;
  }

  private async addDeadline(tx: DatabaseClient, obligationId: string, dueOn: string): Promise<string> {
    const created = await tx.taxDeadline.create({ data: { obligationId, dueOn: dayOf(dueOn) }, select: { id: true } }).catch(this.sameDay);
    return created.id;
  }

  private readonly sameDay = (error: unknown): never => {
    throw isUniqueViolation(error) ? Errors.invalidTransition("There's already a deadline on that day.") : error;
  };

  private async openDeadline(id: string) {
    const deadline = await this.prisma.taxDeadline.findUnique({ where: { id }, include: { obligation: true } });
    if (!deadline) {
      throw Errors.notFound();
    }
    if (deadline.status !== "OPEN") {
      throw Errors.invalidTransition("This has already been marked as filed.");
    }
    return deadline;
  }

  private async obligation(id: string): Promise<TaxObligationView> {
    const obligation = await this.prisma.taxObligation.findUniqueOrThrow({ where: { id }, include: { deadlines: true } });
    return obligationView(obligation, today());
  }

  private async requireCountry(code: string): Promise<void> {
    if (!(await this.prisma.country.findUnique({ where: { code }, select: { code: true } }))) {
      throw Errors.notFound();
    }
  }

  private actor(principal: AuthPrincipal) {
    return { userId: principal.userId, role: principal.role };
  }
}
