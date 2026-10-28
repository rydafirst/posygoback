import { Inject, Injectable, Logger } from "@nestjs/common";

import { sameName } from "../../common/names";
import { lockRow, PrismaService } from "../../database/prisma.service";
import type { IdentityCheck, Prisma } from "../../generated/prisma/client";
import { type IdentityCheckStatus, type IdentityCheckView, SETTLED_IDENTITY_STATUSES } from "../../shared";
import {
  IDENTITY_CHECK_PROVIDER,
  type IdentityCheckProvider,
  type IdentityDecision,
  type IdentitySession,
  type IdentitySubject,
  type IdentitySubjectType,
  type WebhookHeaders,
} from "./providers/identity-check.port";

const NAME_MISMATCH = "the name on your ID doesn't match the name you gave us";

export interface IdentityOutcome {
  subjectId: string;
  sessionId: string;
  provider: string;
  status: IdentityCheckStatus;
  reason: string | null;
}

export interface IdentityOutcomeListener {
  expectedName(subjectId: string, tx: Prisma.TransactionClient): Promise<string | null>;
  onOutcome(outcome: IdentityOutcome, tx: Prisma.TransactionClient): Promise<void>;
}

export function toIdentityCheckView(check: IdentityCheck): IdentityCheckView {
  return {
    status: check.status,
    provider: check.provider,
    documentType: check.documentType,
    issuingCountry: check.issuingCountry,
    documentExpiry: check.documentExpiry?.toISOString().slice(0, 10) ?? null,
    nameMatches: check.nameMatches,
    reason: check.reason,
    decidedAt: check.decidedAt?.toISOString() ?? null,
    updatedAt: check.updatedAt.toISOString(),
  };
}

function effectiveDecision(decision: IdentityDecision, expectedName: string | null): IdentityDecision & { nameMatches: boolean | null } {
  const nameMatches = decision.verifiedName && expectedName ? sameName(decision.verifiedName, expectedName) : null;
  if (decision.status === "APPROVED" && nameMatches === false) {
    return { ...decision, status: "DECLINED", reason: NAME_MISMATCH, nameMatches };
  }
  return { ...decision, nameMatches };
}

@Injectable()
export class IdentityChecksService {
  private readonly logger = new Logger(IdentityChecksService.name);
  private readonly listeners = new Map<IdentitySubjectType, IdentityOutcomeListener>();

  constructor(
    @Inject(IDENTITY_CHECK_PROVIDER) private readonly provider: IdentityCheckProvider,
    private readonly prisma: PrismaService,
  ) {}

  get providerName(): string {
    return this.provider.name;
  }

  listen(type: IdentitySubjectType, listener: IdentityOutcomeListener): void {
    this.listeners.set(type, listener);
  }

  async start(subject: IdentitySubject): Promise<IdentitySession> {
    const session = await this.provider.start(subject);
    await this.prisma.identityCheck.upsert({
      where: { provider_sessionId: { provider: this.provider.name, sessionId: session.sessionId } },
      create: { subjectType: subject.type, subjectId: subject.id, provider: this.provider.name, sessionId: session.sessionId },
      update: { supersededAt: null },
    });
    return session;
  }

  async latest(type: IdentitySubjectType, subjectId: string, client: Prisma.TransactionClient | PrismaService = this.prisma): Promise<IdentityCheckView | null> {
    const check = await client.identityCheck.findFirst({ where: { subjectType: type, subjectId, supersededAt: null }, orderBy: { createdAt: "desc" } });
    return check ? toIdentityCheckView(check) : null;
  }

  async supersede(type: IdentitySubjectType, subjectId: string, tx: Prisma.TransactionClient): Promise<void> {
    await tx.identityCheck.updateMany({ where: { subjectType: type, subjectId, supersededAt: null }, data: { supersededAt: new Date() } });
  }

  async refresh(sessionId: string): Promise<void> {
    const check = await this.find(sessionId);
    if (check && !SETTLED_IDENTITY_STATUSES.includes(check.status)) {
      await this.apply(check);
    }
  }

  async refreshLatest(type: IdentitySubjectType, subjectId: string): Promise<void> {
    const check = await this.prisma.identityCheck.findFirst({ where: { subjectType: type, subjectId, supersededAt: null }, orderBy: { createdAt: "desc" } });
    if (check && !SETTLED_IDENTITY_STATUSES.includes(check.status)) {
      await this.apply(check);
    }
  }

  async receiveWebhook(from: string, rawBody: Buffer, headers: WebhookHeaders): Promise<void> {
    if (from !== this.provider.name) {
      return;
    }
    const event = this.provider.verifyWebhook(rawBody, headers);
    if (!event) {
      return;
    }
    const recorded = await this.prisma.identityWebhookEvent.createMany({ data: [{ provider: this.provider.name, eventId: event.eventId }], skipDuplicates: true });
    if (recorded.count === 0) {
      return;
    }
    try {
      const check = await this.find(event.sessionId);
      if (check) {
        await this.apply(check);
      }
    } catch (error) {
      await this.prisma.identityWebhookEvent.delete({ where: { provider_eventId: { provider: this.provider.name, eventId: event.eventId } } });
      throw error;
    }
  }

  private find(sessionId: string): Promise<IdentityCheck | null> {
    return this.prisma.identityCheck.findUnique({ where: { provider_sessionId: { provider: this.provider.name, sessionId } } });
  }

  private async apply(check: IdentityCheck): Promise<void> {
    const decision = await this.provider.fetchDecision(check.sessionId);
    const listener = this.listeners.get(check.subjectType);
    const status = await this.prisma.$transaction(async (tx) => {
      await lockRow(tx, "identityChecks", check.id);
      const current = await tx.identityCheck.findUniqueOrThrow({ where: { id: check.id } });
      const outcome = effectiveDecision(decision, (await listener?.expectedName(check.subjectId, tx)) ?? null);
      if (outcome.status === current.status) {
        return null;
      }
      await tx.identityCheck.update({
        where: { id: check.id },
        data: {
          status: outcome.status,
          documentType: outcome.documentType,
          issuingCountry: outcome.issuingCountry,
          documentExpiry: outcome.documentExpiry ? new Date(`${outcome.documentExpiry}T00:00:00Z`) : null,
          nameMatches: outcome.nameMatches,
          reason: outcome.reason,
          decidedAt: SETTLED_IDENTITY_STATUSES.includes(outcome.status) ? new Date() : null,
        },
      });
      if (current.supersededAt === null) {
        await listener?.onOutcome({ subjectId: check.subjectId, sessionId: check.sessionId, provider: check.provider, status: outcome.status, reason: outcome.reason }, tx);
      }
      return outcome.status;
    });
    if (status) {
      this.logger.log(`Identity session ${check.sessionId}: ${status}`);
    }
  }
}
