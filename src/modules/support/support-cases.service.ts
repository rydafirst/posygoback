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
import { StaffAlertsService } from "../notifications/staff-alerts.service";
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

export interface ServerFault {
  method: string;
  path: string;
  status: number;
  errorName: string;
  message: string;
  correlationId: string | null;
  userId: string | null;
  countryCode: string | null;
  userAgent: string | null;
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
    private readonly staffAlerts: StaffAlertsService,
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
      const serverCase = await this.caseForCorrelation(tx, details.correlationId);
      if (serverCase) {
        await tx.supportCase.update({ where: { id: serverCase.id }, data: { lastSeenAt: new Date() } });
        await tx.supportReport.create({ data: { ...details, caseId: serverCase.id } });
        return { reference: serverCase.reference, alreadyKnown: true };
      }
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
      await this.staffAlerts.raise("support", {
        countryCode: principal?.countryCode ?? null,
        title: `${result.reference}: ${input.kind === "ERROR" ? "someone hit an error" : "someone needs help"}`,
        body: `On ${input.page}. ${scrubSensitive(input.message) || "No message."}`,
        exceptUserId: principal?.userId,
      });
    }
    return result;
  }

  async captureServerFault(fault: ServerFault): Promise<void> {
    try {
      const fingerprint = createHash("sha256").update(`server|${fault.errorName}|${fault.method} ${normalisePath(fault.path)}`).digest("hex");
      const report = {
        userId: fault.userId,
        message: scrubSensitive(`${fault.errorName}: ${fault.message}`).slice(0, 1000),
        correlationId: fault.correlationId,
        trail: [] as Prisma.InputJsonValue,
        userAgent: fault.userAgent?.slice(0, 512) ?? null,
      };
      const opened = await this.prisma.$transaction(async (tx) => {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${fingerprint}))`;
        const open = await tx.supportCase.findFirst({ where: { fingerprint, status: "OPEN" } });
        if (open) {
          await tx.supportCase.update({ where: { id: open.id }, data: { reportCount: { increment: 1 }, lastSeenAt: new Date() } });
          await tx.supportReport.create({ data: { ...report, caseId: open.id } });
          return null;
        }
        const created = await tx.supportCase.create({
          data: {
            reference: `CASE-${randomCode(8)}`,
            kind: "ERROR",
            source: "SERVER",
            fingerprint,
            page: normalisePath(fault.path).slice(0, 300),
            errorCode: "internal_error",
            errorStatus: fault.status,
            endpoint: `${fault.method} ${fault.path}`.slice(0, 200),
            reports: { create: report },
          },
        });
        return created.reference;
      });
      if (opened) {
        const what = `${fault.errorName} on ${fault.method} ${normalisePath(fault.path)}`;
        await this.tellTeam(opened, "the system failed before anyone reported it", what, normalisePath(fault.path), report.message);
        await this.staffAlerts.raise("support", { countryCode: fault.countryCode, title: `${opened}: the system failed before anyone reported it`, body: `${what}. ${report.message}` });
      }
    } catch (error) {
      this.logger.error(`Couldn't record a server fault: ${error instanceof Error ? error.message : String(error)}`);
    }
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

  private async caseForCorrelation(tx: Prisma.TransactionClient, correlationId: string | null): Promise<{ id: string; reference: string } | null> {
    if (!correlationId) {
      return null;
    }
    const match = await tx.supportReport.findFirst({ where: { correlationId, supportCase: { source: "SERVER", status: "OPEN" } }, select: { supportCase: { select: { id: true, reference: true } } } });
    return match?.supportCase ?? null;
  }

  private async tellSupport(reference: string, input: SupportReport): Promise<void> {
    const what = input.error ? `Error ${input.error.code} (${input.error.status}) on ${input.error.endpoint}` : "A question from a user";
    await this.tellTeam(reference, input.kind === "ERROR" ? "a user hit an error" : "a user needs help", what, input.page, scrubSensitive(input.message));
  }

  private async tellTeam(reference: string, headline: string, what: string, page: string, message: string): Promise<void> {
    if (!this.config.SUPPORT_EMAIL) {
      return;
    }
    await this.email
      .send(SupportEmails.newCase(this.config.SUPPORT_EMAIL, reference, headline, what, page, message, this.config.WEB_PUBLIC_URL))
      .catch((error: unknown) => this.logger.warn(`Couldn't email support about ${reference}: ${error instanceof Error ? error.message : String(error)}`));
  }

}
