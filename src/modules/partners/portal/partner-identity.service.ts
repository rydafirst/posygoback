import { Inject, Injectable, type OnModuleInit } from "@nestjs/common";

import type { AuthPrincipal, RequestMeta } from "../../../common/auth/auth-principal";
import { Errors } from "../../../common/http/app-exception";
import { APP_CONFIG } from "../../../config/config.module";
import type { AppConfig } from "../../../config/config.schema";
import { lockRow, PrismaService } from "../../../database/prisma.service";
import type { Prisma } from "../../../generated/prisma/client";
import { AuditService, SYSTEM_ACTOR } from "../../../infrastructure/audit/audit.service";
import { AttemptLimiterService } from "../../../infrastructure/rate-limit/attempt-limiter.service";
import type { IdentitySessionView } from "../../../shared";
import { type IdentityOutcome, type IdentityOutcomeListener, IdentityChecksService } from "../../identity/identity-checks.service";
import { actorOf } from "../admin/admin-partners.service";
import { PartnerAccessService, partnerIdOf } from "./partner-access.service";

const IDENTITY_STARTS_PER_DAY = { name: "partner-identity-starts", limit: 5, windowSeconds: 24 * 60 * 60 };
const VERIFYING = ["VERIFYING"] as const;
const STARTABLE = ["NOT_STARTED", "SUBMITTED", "REJECTED"] as const;

interface IdentityDetails {
  provider?: string;
  sessionId?: string;
  inReview?: boolean;
  [key: string]: unknown;
}

@Injectable()
export class PartnerIdentityService implements IdentityOutcomeListener, OnModuleInit {
  constructor(
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    private readonly checks: IdentityChecksService,
    private readonly prisma: PrismaService,
    private readonly access: PartnerAccessService,
    private readonly limiter: AttemptLimiterService,
    private readonly audit: AuditService,
  ) {}

  onModuleInit(): void {
    this.checks.listen("PARTNER", this);
  }

  async start(principal: AuthPrincipal, meta: RequestMeta): Promise<IdentitySessionView> {
    const partnerId = partnerIdOf(principal);
    await this.limiter.consume(IDENTITY_STARTS_PER_DAY, partnerId);
    const session = await this.checks.start({ type: "PARTNER", id: partnerId, returnUrl: `${this.config.WEB_PUBLIC_URL}/admin/partnership?identity=returned` });
    const provider = this.checks.providerName;
    await this.access.mutate(principal, VERIFYING, "Identity checks happen before review.", async (tx, partner) => {
      const updated = await tx.partnerCheck.updateMany({
        where: { partnerId: partner.id, kind: "IDENTITY", status: { in: [...STARTABLE] } },
        data: {
          status: "SUBMITTED",
          details: { provider, sessionId: session.sessionId },
          fileIds: [],
          statement: null,
          submittedBy: principal.userId,
          submittedAt: new Date(),
          reviewedBy: null,
          reviewedAt: null,
          reviewNote: null,
          filesPurgedAt: null,
        },
      });
      if (updated.count === 0) {
        throw Errors.invalidTransition("This step has already been accepted.");
      }
      await this.audit.record(
        { actor: actorOf(principal), action: "partner.identity_started", resourceType: "fulfilment_partner", resourceId: partner.id, countryCode: partner.countryCode, after: { provider }, meta },
        tx,
      );
    });
    return { url: session.url };
  }

  async refresh(principal: AuthPrincipal): Promise<void> {
    const check = await this.prisma.partnerCheck.findUnique({ where: { partnerId_kind: { partnerId: partnerIdOf(principal), kind: "IDENTITY" } } });
    const sessionId = (check?.details as IdentityDetails | null)?.sessionId;
    if (check?.status === "SUBMITTED" && sessionId) {
      await this.checks.refresh(sessionId);
    }
  }

  async expectedName(partnerId: string, tx: Prisma.TransactionClient): Promise<string | null> {
    const partner = await tx.fulfilmentPartner.findUnique({ where: { id: partnerId }, select: { legalName: true } });
    return partner?.legalName ?? null;
  }

  async onOutcome(outcome: IdentityOutcome, tx: Prisma.TransactionClient): Promise<void> {
    if (outcome.status === "PENDING") {
      return;
    }
    const check = await tx.partnerCheck.findFirst({ where: { partnerId: outcome.subjectId, kind: "IDENTITY", status: "SUBMITTED", details: { path: ["sessionId"], equals: outcome.sessionId } } });
    if (!check) {
      return;
    }
    await lockRow(tx, "fulfilmentPartners", check.partnerId);
    const details = Object.fromEntries(Object.entries(check.details as IdentityDetails).filter(([key]) => key !== "inReview"));
    if (outcome.status === "IN_REVIEW") {
      await tx.partnerCheck.update({ where: { id: check.id }, data: { details: { ...details, inReview: true } } });
      return;
    }
    const verified = outcome.status === "APPROVED";
    const reason = outcome.reason ?? "the check didn't pass";
    const updated = await tx.partnerCheck.updateMany({
      where: { id: check.id, status: "SUBMITTED" },
      data: {
        status: verified ? "ACCEPTED" : "REJECTED",
        details: { ...details, verifiedAt: new Date().toISOString(), ...(verified ? {} : { failureReason: reason }) },
        reviewedAt: new Date(),
        reviewNote: verified ? null : `The identity check didn't pass: ${reason}`,
      },
    });
    if (updated.count > 0) {
      await this.audit.record(
        { actor: SYSTEM_ACTOR, action: `partner.identity_${verified ? "verified" : "failed"}`, resourceType: "fulfilment_partner", resourceId: check.partnerId, after: { provider: outcome.provider } },
        tx,
      );
    }
  }
}
