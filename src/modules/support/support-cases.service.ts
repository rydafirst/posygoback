import { createHash } from "node:crypto";

import { Inject, Injectable, Logger } from "@nestjs/common";

import type { AuthPrincipal, RequestMeta } from "../../common/auth/auth-principal";
import { Errors } from "../../common/http/app-exception";
import { APP_CONFIG } from "../../config/config.module";
import type { AppConfig } from "../../config/config.schema";
import { PrismaService } from "../../database/prisma.service";
import type { Prisma } from "../../generated/prisma/client";
import { type AuditActor, AuditService } from "../../infrastructure/audit/audit.service";
import { EMAIL_SENDER, type EmailSender } from "../../infrastructure/email/email.port";
import { AttemptLimiterService } from "../../infrastructure/rate-limit/attempt-limiter.service";
import { scrubSensitive, type SupportReport, type SupportReportResult } from "../../shared";
import { randomCode } from "../stock/inbound/references";
import { NotificationsService } from "../notifications/notifications.service";
import { SupportEmails } from "./support-emails";

const PER_IP = { name: "support-report-ip", limit: 20, windowSeconds: 60 * 60 };
const PER_USER = { name: "support-report-user", limit: 30, windowSeconds: 24 * 60 * 60 };
const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;
const LONG_NUMBER = /\b\d{4,}\b/g;

export function normalisePath(path: string): string {
  return path.replace(UUID, ":id").replace(LONG_NUMBER, ":n").toLowerCase();
}

function fingerprintOf(report: SupportReport): string | null {
  if (!report.error) {
    return null;
  }
  const { code, status, endpoint } = report.error;
  return createHash("sha256")
    .update(`${code}|${status}|${normalisePath(endpoint)}|${normalisePath(report.page)}`)
    .digest("hex");
}

@Injectable()
export class SupportCasesService {
  private readonly logger = new Logger(SupportCasesService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly limiter: AttemptLimiterService,
    private readonly audit: AuditService,
    private readonly notifications: NotificationsService,
    @Inject(EMAIL_SENDER) private readonly email: EmailSender,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  async report(input: SupportReport, meta: RequestMeta, principal: AuthPrincipal | null): Promise<SupportReportResult> {
    await this.limiter.consume(PER_IP, meta.ip);
    if (principal) {
      await this.limiter.consume(PER_USER, principal.userId);
    }
    const fingerprint = fingerprintOf(input);
    const details = {
      userId: principal?.userId ?? null,
      contactEmail: principal ? null : (input.contactEmail ?? null),
      message: scrubSensitive(input.message),
      correlationId: input.error?.correlationId ?? null,
      trail: input.trail.map((step) => ({ at: step.at, what: scrubSensitive(step.what) })) as Prisma.InputJsonValue,
      userAgent: meta.userAgent,
    };
    const result = await this.prisma.$transaction(async (tx) => {
      if (fingerprint) {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${fingerprint}))`;
        const open = await tx.supportCase.findFirst({ where: { fingerprint, status: "OPEN" } });
        if (open) {
          await tx.supportCase.update({ where: { id: open.id }, data: { reportCount: { increment: 1 }, lastSeenAt: new Date() } });
          await tx.supportReport.create({ data: { ...details, caseId: open.id } });
          return { reference: open.reference, alreadyKnown: true };
        }
      }
      const created = await tx.supportCase.create({
        data: {
          reference: `CASE-${randomCode(8)}`,
          kind: input.kind,
          fingerprint,
          page: input.page,
          errorCode: input.error?.code ?? null,
          errorStatus: input.error?.status ?? null,
          endpoint: input.error?.endpoint ?? null,
          reports: { create: details },
        },
      });
      return { reference: created.reference, alreadyKnown: false };
    });
    if (!result.alreadyKnown) {
      await this.tellSupport(result.reference, input);
    }
    return result;
  }

  async resolve(caseId: string, note: string, actor: AuditActor, meta: RequestMeta): Promise<void> {
    const reporters = await this.prisma.$transaction(async (tx) => {
      const updated = await tx.supportCase.updateMany({ where: { id: caseId, status: "OPEN" }, data: { status: "RESOLVED", resolvedAt: new Date(), resolvedBy: actor.userId, resolutionNote: note } });
      if (updated.count === 0) {
        if (await tx.supportCase.count({ where: { id: caseId } })) {
          throw Errors.invalidTransition("This case is already resolved.");
        }
        throw Errors.notFound();
      }
      const supportCase = await tx.supportCase.findUniqueOrThrow({
        where: { id: caseId },
        include: { reports: { select: { contactEmail: true, user: { select: { id: true, vendorId: true, email: true } } } } },
      });
      await this.audit.record({ actor, action: "support.case_resolved", resourceType: "support_case", resourceId: caseId, after: { note }, meta }, tx);
      const people = [...new Map(supportCase.reports.flatMap((report) => (report.user ? [[report.user.id, report.user] as const] : []))).values()];
      const emails = new Set(supportCase.reports.map((report) => report.user?.email ?? report.contactEmail).filter((email): email is string => Boolean(email)));
      return { reference: supportCase.reference, page: supportCase.page, people, emails };
    });
    const notice = { title: "The problem you reported is sorted", body: `${reporters.reference}: ${note}` };
    const vendorIds = new Set(reporters.people.flatMap((person) => (person.vendorId ? [person.vendorId] : [])));
    for (const vendorId of vendorIds) {
      await this.notifications.forVendor(vendorId, notice);
    }
    for (const person of reporters.people.filter((entry) => !entry.vendorId)) {
      await this.notifications.forUser(person.id, notice);
    }
    for (const to of reporters.emails) {
      await this.email
        .send(SupportEmails.caseResolved(to, reporters.reference, note, reporters.page, this.config.WEB_PUBLIC_URL))
        .catch((error: unknown) => this.logger.warn(`Couldn't email ${reporters.reference} reporter: ${error instanceof Error ? error.message : String(error)}`));
    }
  }

  private async tellSupport(reference: string, input: SupportReport): Promise<void> {
    if (!this.config.SUPPORT_EMAIL) {
      return;
    }
    const what = input.error ? `Error ${input.error.code} (${input.error.status}) on ${input.error.endpoint}` : "A question from a user";
    try {
      await this.email.send(SupportEmails.newCase(this.config.SUPPORT_EMAIL, reference, input.kind === "ERROR", what, input.page, scrubSensitive(input.message), this.config.WEB_PUBLIC_URL));
    } catch (error) {
      this.logger.warn(`Couldn't email support about ${reference}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
}
