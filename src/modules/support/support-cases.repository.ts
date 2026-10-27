import { Injectable } from "@nestjs/common";

import { Errors } from "../../common/http/app-exception";
import { PrismaService } from "../../database/prisma.service";
import type { SupportCase } from "../../generated/prisma/client";
import type { SupportCaseDetailView, SupportCaseStatus, SupportCaseView } from "../../shared";

const PAGE_SIZE = 100;
const REPORTS_SHOWN = 50;

function view(row: SupportCase): SupportCaseView {
  return {
    id: row.id,
    reference: row.reference,
    kind: row.kind,
    status: row.status,
    page: row.page,
    errorCode: row.errorCode,
    errorStatus: row.errorStatus,
    endpoint: row.endpoint,
    reports: row.reportCount,
    firstSeenAt: row.firstSeenAt.toISOString(),
    lastSeenAt: row.lastSeenAt.toISOString(),
    resolvedAt: row.resolvedAt?.toISOString() ?? null,
    resolutionNote: row.resolutionNote,
  };
}

type Step = { at: string; what: string };

function isStep(value: unknown): value is Step {
  const step = value as Partial<Record<keyof Step, unknown>> | null;
  return typeof step?.at === "string" && typeof step.what === "string";
}

function trailOf(value: unknown): Step[] {
  return Array.isArray(value) ? value.filter(isStep) : [];
}

@Injectable()
export class SupportCasesRepository {
  constructor(private readonly prisma: PrismaService) {}

  async list(status: SupportCaseStatus | undefined): Promise<SupportCaseView[]> {
    const rows = await this.prisma.supportCase.findMany({ where: status ? { status } : {}, orderBy: { lastSeenAt: "desc" }, take: PAGE_SIZE });
    return rows.map(view);
  }

  async detail(caseId: string): Promise<SupportCaseDetailView> {
    const row = await this.prisma.supportCase.findUnique({
      where: { id: caseId },
      include: { reports: { orderBy: { createdAt: "desc" }, take: REPORTS_SHOWN, include: { user: { select: { email: true, role: true, vendor: { select: { businessName: true } } } } } } },
    });
    if (!row) {
      throw Errors.notFound();
    }
    return {
      ...view(row),
      reportDetails: row.reports.map((report) => ({
        id: report.id,
        at: report.createdAt.toISOString(),
        message: report.message,
        correlationId: report.correlationId,
        trail: trailOf(report.trail),
        userAgent: report.userAgent,
        reporter: { email: report.user?.email ?? report.contactEmail, role: report.user?.role ?? null, business: report.user?.vendor?.businessName ?? null },
      })),
    };
  }
}
