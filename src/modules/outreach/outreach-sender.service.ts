import { Inject, Injectable } from "@nestjs/common";

import type { AuthPrincipal, RequestMeta } from "../../common/auth/auth-principal";
import { Errors } from "../../common/http/app-exception";
import { PrismaService } from "../../database/prisma.service";
import { AuditService } from "../../infrastructure/audit/audit.service";
import { EMAIL_TRANSPORT, type EmailTransport } from "../../infrastructure/email/email.port";
import { fillOutreach, OUTREACH_LIMITS, type OutreachSendResultView, type OutreachSkip, type SendOutreachInput } from "../../shared";
import { OutreachOptOutsService } from "./outreach-opt-outs.service";

export const OUTREACH_PACING_MS = Symbol("OUTREACH_PACING_MS");

function startOfDay(now: Date): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
}

@Injectable()
export class OutreachSenderService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly optOuts: OutreachOptOutsService,
    @Inject(EMAIL_TRANSPORT) private readonly transport: EmailTransport,
    @Inject(OUTREACH_PACING_MS) private readonly pacingMs: number,
  ) {}

  async send(principal: AuthPrincipal, input: SendOutreachInput, meta: RequestMeta): Promise<OutreachSendResultView> {
    const contacts = await this.prisma.outreachContact.findMany({ where: { id: { in: input.contactIds } } });
    const skipped: OutreachSkip[] = [];
    const ready = contacts.filter((contact) => {
      const reason = !contact.email ? "No email address" : contact.status === "UNSUBSCRIBED" ? "Asked not to be emailed" : null;
      if (reason) {
        skipped.push({ contactId: contact.id, business: contact.business, reason });
      }
      return reason === null;
    });
    const sentToday = await this.sentSince(startOfDay(new Date()));
    if (sentToday + ready.length > OUTREACH_LIMITS.perDay) {
      throw Errors.rateLimited(`You can send ${OUTREACH_LIMITS.perDay} outreach emails a day. ${Math.max(0, OUTREACH_LIMITS.perDay - sentToday)} are left today.`);
    }

    let sent = 0;
    let failed = 0;
    for (const [index, contact] of ready.entries()) {
      if (index > 0) {
        await new Promise((resolve) => setTimeout(resolve, this.pacingMs));
      }
      const subject = fillOutreach(input.subject, contact);
      const body = fillOutreach(input.body, contact);
      const outcome = await this.deliver(contact.id, contact.email!, subject, body);
      await this.prisma.outreachMessage.create({ data: { contactId: contact.id, subject, body, sentBy: principal.userId, ...outcome } });
      if (outcome.status === "SENT") {
        sent += 1;
        await this.prisma.outreachContact.update({ where: { id: contact.id }, data: { lastMessagedAt: new Date(), ...(contact.status === "NOT_CONTACTED" ? { status: "MESSAGED" } : {}) } });
      } else {
        failed += 1;
      }
    }
    await this.audit.record({
      actor: { userId: principal.userId, role: principal.role },
      action: "outreach.sent",
      resourceType: "outreach_contact",
      resourceId: null,
      after: { sent, failed, skipped: skipped.length },
      meta,
    });
    return { sent, failed, skipped, sentToday: sentToday + sent };
  }

  private async deliver(contactId: string, to: string, subject: string, text: string): Promise<{ status: "SENT" | "FAILED"; providerId: string | null; error: string | null }> {
    try {
      const receipt = await this.transport.deliver({
        to,
        subject,
        text,
        kind: "outreach",
        optOut: { question: "Not interested?", label: "Don't email me again", url: this.optOuts.stopUrl(contactId) },
      });
      return { status: "SENT", providerId: receipt.providerId?.slice(0, 100) ?? null, error: null };
    } catch (error) {
      return { status: "FAILED", providerId: null, error: (error instanceof Error ? error.message : String(error)).slice(0, 300) };
    }
  }

  private sentSince(since: Date): Promise<number> {
    return this.prisma.outreachMessage.count({ where: { status: "SENT", sentAt: { gte: since } } });
  }
}
