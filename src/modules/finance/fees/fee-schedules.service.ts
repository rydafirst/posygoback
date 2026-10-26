import { Injectable } from "@nestjs/common";

import type { AuthPrincipal, RequestMeta } from "../../../common/auth/auth-principal";
import { Errors } from "../../../common/http/app-exception";
import { type DatabaseClient, isUniqueViolation, lockRow, PrismaService } from "../../../database/prisma.service";
import type { FeeSchedule as FeeScheduleRow, Prisma } from "../../../generated/prisma/client";
import { AuditService } from "../../../infrastructure/audit/audit.service";
import { type FeeSchedule, type FeeScheduleDecisionInput, type FeeScheduleView, type ProposeFeeScheduleInput } from "../../../shared";
import { reviewerCountryScope } from "../../onboarding/scope";

export interface ActiveSchedule {
  id: string;
  schedule: FeeSchedule;
  currency: string;
}

const VIEW_INCLUDE = { proposer: { select: { email: true } }, decider: { select: { email: true } }, country: { select: { currency: true } } } satisfies Prisma.FeeScheduleInclude;

type ScheduleWithPeople = Prisma.FeeScheduleGetPayload<{ include: typeof VIEW_INCLUDE }>;

function toView(row: ScheduleWithPeople): FeeScheduleView {
  return {
    id: row.id,
    countryCode: row.countryCode,
    currency: row.country.currency,
    version: row.version,
    status: row.status,
    schedule: row.schedule as unknown as FeeSchedule,
    note: row.note,
    proposedByEmail: row.proposer?.email ?? "Platform setup",
    proposedAt: row.proposedAt.toISOString(),
    decidedByEmail: row.decider?.email ?? null,
    decidedAt: row.decidedAt?.toISOString() ?? null,
    decisionNote: row.decisionNote,
  };
}

@Injectable()
export class FeeSchedulesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async active(countryCode: string, client: DatabaseClient = this.prisma): Promise<ActiveSchedule> {
    const row = await client.feeSchedule.findFirst({ where: { countryCode, status: "ACTIVE" }, include: { country: { select: { currency: true } } } });
    if (!row) {
      throw Errors.feeScheduleMissing();
    }
    return { id: row.id, schedule: row.schedule as unknown as FeeSchedule, currency: row.country.currency };
  }

  async history(principal: AuthPrincipal, countryCode: string): Promise<FeeScheduleView[]> {
    const scope = reviewerCountryScope(principal);
    if (scope && scope !== countryCode) {
      throw Errors.notFound();
    }
    const rows = await this.prisma.feeSchedule.findMany({ where: { countryCode }, include: VIEW_INCLUDE, orderBy: { version: "desc" }, take: 50 });
    return rows.map(toView);
  }

  async propose(principal: AuthPrincipal, countryCode: string, input: ProposeFeeScheduleInput, meta: RequestMeta): Promise<FeeScheduleView> {
    if (!(await this.prisma.country.findUnique({ where: { code: countryCode } }))) {
      throw Errors.notFound();
    }
    try {
      const created = await this.prisma.$transaction(async (tx) => {
        const latest = await tx.feeSchedule.aggregate({ where: { countryCode }, _max: { version: true } });
        const row = await tx.feeSchedule.create({
          data: { countryCode, version: (latest._max.version ?? 0) + 1, schedule: input.schedule, note: input.note, proposedBy: principal.userId },
          include: VIEW_INCLUDE,
        });
        await this.audit.record(
          { actor: { userId: principal.userId, role: principal.role }, action: "fee_schedule.proposed", resourceType: "fee_schedule", resourceId: row.id, countryCode, after: input.schedule, meta },
          tx,
        );
        return row;
      });
      return toView(created);
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw Errors.invalidTransition("A change is already waiting for approval in this market. Approve or reject it first.");
      }
      throw error;
    }
  }

  async decide(principal: AuthPrincipal, scheduleId: string, input: FeeScheduleDecisionInput, meta: RequestMeta): Promise<FeeScheduleView> {
    const decided = await this.prisma.$transaction(async (tx) => {
      await lockRow(tx, "feeSchedules", scheduleId);
      const row = await tx.feeSchedule.findUnique({ where: { id: scheduleId } });
      if (!row) {
        throw Errors.notFound();
      }
      if (row.status !== "PROPOSED") {
        throw Errors.invalidTransition("This change has already been decided.");
      }
      if (row.proposedBy === principal.userId) {
        throw Errors.forbidden("Someone other than the proposer must approve a fee change.");
      }
      const previous = await this.activeRow(tx, row.countryCode);
      if (input.approve && previous) {
        await tx.feeSchedule.update({ where: { id: previous.id }, data: { status: "SUPERSEDED" } });
      }
      const updated = await tx.feeSchedule.update({
        where: { id: row.id },
        data: { status: input.approve ? "ACTIVE" : "REJECTED", decidedBy: principal.userId, decidedAt: new Date(), decisionNote: input.note },
        include: VIEW_INCLUDE,
      });
      await this.audit.record(
        {
          actor: { userId: principal.userId, role: principal.role },
          action: input.approve ? "fee_schedule.approved" : "fee_schedule.rejected",
          resourceType: "fee_schedule",
          resourceId: row.id,
          countryCode: row.countryCode,
          before: previous?.schedule ?? null,
          after: input.approve ? row.schedule : null,
          meta,
        },
        tx,
      );
      return updated;
    });
    return toView(decided);
  }

  private activeRow(tx: Prisma.TransactionClient, countryCode: string): Promise<FeeScheduleRow | null> {
    return tx.feeSchedule.findFirst({ where: { countryCode, status: "ACTIVE" } });
  }
}
