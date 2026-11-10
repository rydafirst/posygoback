import { Injectable } from "@nestjs/common";

import type { AuthPrincipal, RequestMeta } from "../../common/auth/auth-principal";
import { Errors } from "../../common/http/app-exception";
import type { Prisma } from "../../generated/prisma/client";
import { PrismaService } from "../../database/prisma.service";
import { AuditService } from "../../infrastructure/audit/audit.service";
import type { ImportOutreachInput, OutreachContactDetailView, OutreachContactInput, OutreachContactView, OutreachImportResultView, OutreachListQuery, UpdateOutreachContactInput } from "../../shared";

const LIST_LIMIT = 500;

const withCount = { _count: { select: { messages: true } } } as const;
type ContactRow = Prisma.OutreachContactGetPayload<{ include: typeof withCount }>;

function toView(row: ContactRow): OutreachContactView {
  return {
    id: row.id,
    business: row.business,
    contactName: row.contactName,
    email: row.email,
    phone: row.phone,
    website: row.website,
    country: row.country,
    city: row.city,
    kind: row.kind,
    status: row.status,
    notes: row.notes,
    source: row.source,
    lastMessagedAt: row.lastMessagedAt?.toISOString() ?? null,
    messageCount: row._count.messages,
    createdAt: row.createdAt.toISOString(),
  };
}

function nullable<T extends object>(input: T): { [K in keyof T]: T[K] | null } {
  return Object.fromEntries(Object.entries(input).map(([key, value]) => [key, value ?? null])) as { [K in keyof T]: T[K] | null };
}

function contactKeys(contact: { business: string; country: string; email?: string | null }): string[] {
  const named = `business:${contact.business.trim().toLowerCase()}|${contact.country.trim().toLowerCase()}`;
  return contact.email ? [named, `email:${contact.email.trim().toLowerCase()}`] : [named];
}

@Injectable()
export class OutreachContactsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async list(query: OutreachListQuery): Promise<OutreachContactView[]> {
    const rows = await this.prisma.outreachContact.findMany({
      where: {
        status: query.status,
        country: query.country ? { equals: query.country, mode: "insensitive" } : undefined,
        OR: query.q
          ? [{ business: { contains: query.q, mode: "insensitive" } }, { email: { contains: query.q, mode: "insensitive" } }, { city: { contains: query.q, mode: "insensitive" } }]
          : undefined,
      },
      include: withCount,
      orderBy: [{ country: "asc" }, { createdAt: "desc" }],
      take: LIST_LIMIT,
    });
    return rows.map(toView);
  }

  async detail(id: string): Promise<OutreachContactDetailView> {
    const row = await this.prisma.outreachContact.findUnique({ where: { id }, include: { ...withCount, messages: { orderBy: { sentAt: "desc" }, include: { sender: { select: { email: true } } } } } });
    if (!row) {
      throw Errors.notFound("That contact doesn't exist.");
    }
    return {
      ...toView(row),
      messages: row.messages.map((message) => ({
        id: message.id,
        subject: message.subject,
        body: message.body,
        status: message.status,
        error: message.error,
        sentAt: message.sentAt.toISOString(),
        sentByEmail: message.sender.email,
      })),
    };
  }

  async create(principal: AuthPrincipal, input: OutreachContactInput, meta: RequestMeta): Promise<OutreachContactView> {
    await this.assertEmailFree(input.email);
    const row = await this.prisma.outreachContact.create({
      data: { ...nullable(input), kind: input.kind, business: input.business, country: input.country, createdBy: principal.userId },
      include: withCount,
    });
    await this.audit.record({
      actor: { userId: principal.userId, role: principal.role },
      action: "outreach.contact_added",
      resourceType: "outreach_contact",
      resourceId: row.id,
      after: { business: row.business, country: row.country },
      meta,
    });
    return toView(row);
  }

  async import(principal: AuthPrincipal, input: ImportOutreachInput, meta: RequestMeta): Promise<OutreachImportResultView> {
    const existing = await this.prisma.outreachContact.findMany({ select: { business: true, country: true, email: true } });
    const taken = new Set(existing.flatMap(contactKeys));
    const duplicates: string[] = [];
    const fresh = input.contacts.filter((contact) => {
      const keys = contactKeys(contact);
      if (keys.some((key) => taken.has(key))) {
        duplicates.push(contact.business);
        return false;
      }
      keys.forEach((key) => taken.add(key));
      return true;
    });
    if (fresh.length > 0) {
      await this.prisma.outreachContact.createMany({
        data: fresh.map((contact) => ({ ...nullable(contact), kind: contact.kind, business: contact.business, country: contact.country, createdBy: principal.userId })),
      });
    }
    await this.audit.record({
      actor: { userId: principal.userId, role: principal.role },
      action: "outreach.contacts_imported",
      resourceType: "outreach_contact",
      resourceId: null,
      after: { added: fresh.length, duplicates: duplicates.length },
      meta,
    });
    return { added: fresh.length, duplicates };
  }

  async update(principal: AuthPrincipal, id: string, input: UpdateOutreachContactInput, meta: RequestMeta): Promise<OutreachContactView> {
    const current = await this.prisma.outreachContact.findUnique({ where: { id }, select: { status: true, email: true } });
    if (!current) {
      throw Errors.notFound("That contact doesn't exist.");
    }
    if (current.status === "UNSUBSCRIBED" && input.status) {
      throw Errors.invalidTransition("This contact asked not to be emailed, so their status stays as unsubscribed.");
    }
    if (input.email && input.email !== current.email?.toLowerCase()) {
      await this.assertEmailFree(input.email);
    }
    const row = await this.prisma.outreachContact.update({ where: { id }, data: Object.fromEntries(Object.entries(input).filter(([, value]) => value !== undefined)), include: withCount });
    await this.audit.record({
      actor: { userId: principal.userId, role: principal.role },
      action: "outreach.contact_updated",
      resourceType: "outreach_contact",
      resourceId: id,
      after: { status: row.status },
      meta,
    });
    return toView(row);
  }

  async remove(principal: AuthPrincipal, id: string, meta: RequestMeta): Promise<void> {
    const { count } = await this.prisma.outreachContact.deleteMany({ where: { id } });
    if (count === 0) {
      throw Errors.notFound("That contact doesn't exist.");
    }
    await this.audit.record({ actor: { userId: principal.userId, role: principal.role }, action: "outreach.contact_removed", resourceType: "outreach_contact", resourceId: id, meta });
  }

  private async assertEmailFree(email: string | undefined): Promise<void> {
    if (!email) {
      return;
    }
    const existing = await this.prisma.outreachContact.findFirst({ where: { email: { equals: email, mode: "insensitive" } }, select: { business: true } });
    if (existing) {
      throw Errors.validation({ email: [`${existing.business} already uses this email.`] });
    }
  }
}
