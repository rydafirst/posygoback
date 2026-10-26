import { Injectable } from "@nestjs/common";

import type { RequestMeta } from "../../common/auth/auth-principal";
import { type DatabaseClient, jsonOrNull, PrismaService } from "../../database/prisma.service";
import type { Role } from "../../shared";

export interface AuditActor {
  userId: string | null;
  role: Role | null;
}

export interface AuditEvent {
  actor: AuditActor;
  action: string;
  resourceType: string;
  resourceId?: string | null;
  countryCode?: string | null;
  vendorId?: string | null;
  before?: unknown;
  after?: unknown;
  meta?: RequestMeta;
}

export const SYSTEM_ACTOR: AuditActor = { userId: null, role: null };

@Injectable()
export class AuditService {
  constructor(private readonly prisma: PrismaService) {}

  async record(event: AuditEvent, client: DatabaseClient = this.prisma): Promise<void> {
    await client.auditLogEntry.create({
      data: {
        actorId: event.actor.userId,
        actorRole: event.actor.role,
        action: event.action,
        resourceType: event.resourceType,
        resourceId: event.resourceId ?? null,
        countryCode: event.countryCode ?? null,
        vendorId: event.vendorId ?? null,
        beforeState: jsonOrNull(event.before),
        afterState: jsonOrNull(event.after),
        ip: event.meta?.ip ?? null,
        userAgent: event.meta?.userAgent ?? null,
        correlationId: event.meta?.correlationId ?? null,
      },
    });
  }
}
