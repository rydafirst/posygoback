import { Inject, Injectable, type OnModuleInit } from "@nestjs/common";

import type { AuthPrincipal, RequestMeta } from "../../../common/auth/auth-principal";
import { Errors } from "../../../common/http/app-exception";
import { APP_CONFIG } from "../../../config/config.module";
import type { AppConfig } from "../../../config/config.schema";
import type { Prisma } from "../../../generated/prisma/client";
import { AuditService, SYSTEM_ACTOR } from "../../../infrastructure/audit/audit.service";
import { AttemptLimiterService } from "../../../infrastructure/rate-limit/attempt-limiter.service";
import { EDITABLE_VERIFICATION_STATUSES, type IdentitySessionView, PASSING_IDENTITY_STATUSES } from "../../../shared";
import { type IdentityOutcome, type IdentityOutcomeListener, IdentityChecksService } from "../../identity/identity-checks.service";
import { vendorIdOf } from "../scope";
import { VerificationStore } from "./verification.store";

const IDENTITY_STARTS_PER_DAY = { name: "vendor-identity-starts", limit: 5, windowSeconds: 24 * 60 * 60 };

@Injectable()
export class VendorIdentityService implements IdentityOutcomeListener, OnModuleInit {
  constructor(
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    private readonly checks: IdentityChecksService,
    private readonly store: VerificationStore,
    private readonly limiter: AttemptLimiterService,
    private readonly audit: AuditService,
  ) {}

  onModuleInit(): void {
    this.checks.listen("VENDOR", this);
  }

  async start(principal: AuthPrincipal, meta: RequestMeta): Promise<IdentitySessionView> {
    const vendorId = vendorIdOf(principal);
    const record = await this.store.find(vendorId);
    if (record && !EDITABLE_VERIFICATION_STATUSES.includes(record.status)) {
      throw Errors.invalidTransition("Your verification is with our reviewers and can't be changed right now.");
    }
    if (!record?.answers.contactFullName) {
      throw Errors.validation({ contactFullName: ["Add the contact person's full name first"] });
    }
    const latest = await this.checks.latest("VENDOR", vendorId);
    if (latest && PASSING_IDENTITY_STATUSES.includes(latest.status)) {
      throw Errors.invalidTransition("Your identity check is already done.");
    }
    await this.limiter.consume(IDENTITY_STARTS_PER_DAY, vendorId);
    const session = await this.checks.start({ type: "VENDOR", id: vendorId, returnUrl: `${this.config.WEB_PUBLIC_URL}/verification?identity=returned` });
    await this.audit.record({
      actor: { userId: principal.userId, role: principal.role },
      action: "verification.identity_started",
      resourceType: "vendor_verification",
      resourceId: vendorId,
      vendorId,
      countryCode: record.countryCode,
      after: { provider: this.checks.providerName },
      meta,
    });
    return { url: session.url };
  }

  refresh(principal: AuthPrincipal): Promise<void> {
    return this.checks.refreshLatest("VENDOR", vendorIdOf(principal));
  }

  async expectedName(vendorId: string, tx: Prisma.TransactionClient): Promise<string | null> {
    return (await this.store.find(vendorId, tx))?.answers.contactFullName ?? null;
  }

  async onOutcome(outcome: IdentityOutcome, tx: Prisma.TransactionClient): Promise<void> {
    await this.audit.record(
      {
        actor: SYSTEM_ACTOR,
        action: `verification.identity_${outcome.status.toLowerCase()}`,
        resourceType: "vendor_verification",
        resourceId: outcome.subjectId,
        vendorId: outcome.subjectId,
        after: { provider: outcome.provider, reason: outcome.reason },
      },
      tx,
    );
  }
}
