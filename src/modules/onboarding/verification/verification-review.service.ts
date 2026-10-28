import { Inject, Injectable } from "@nestjs/common";
import { type DocumentSlot, type VerificationDecisionInput, type VerificationStatus } from "../../../shared";

import type { AuthPrincipal, RequestMeta } from "../../../common/auth/auth-principal";
import { Errors } from "../../../common/http/app-exception";
import { APP_CONFIG } from "../../../config/config.module";
import type { AppConfig } from "../../../config/config.schema";
import { PrismaService } from "../../../database/prisma.service";
import { AuditService } from "../../../infrastructure/audit/audit.service";
import { EMAIL_SENDER, type EmailSender } from "../../../infrastructure/email/email.port";
import { UsersRepository } from "../../auth/users.repository";
import { FilesService } from "../../files/files.service";
import { IdentityChecksService } from "../../identity/identity-checks.service";
import { OnboardingEmails } from "../onboarding-emails";
import { reviewerCountryScope } from "../scope";
import { ActivationNoticesService } from "../activation/activation-notices.service";
import { type ActivationResult, VendorActivationService } from "../vendor-activation.service";
import { REVIEWABLE_STATUSES, type VerificationRecord, VerificationStore } from "./verification.store";
import { NotificationsService } from "../../notifications/notifications.service";

const DECISION_STATUS = { APPROVE: "APPROVED", REJECT: "REJECTED", REQUEST_RESUBMISSION: "RESUBMISSION_REQUIRED" } as const satisfies Record<VerificationDecisionInput["decision"], VerificationStatus>;

@Injectable()
export class VerificationReviewService {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(EMAIL_SENDER) private readonly email: EmailSender,
    private readonly store: VerificationStore,
    private readonly files: FilesService,
    private readonly activation: VendorActivationService,
    private readonly notices: ActivationNoticesService,
    private readonly users: UsersRepository,
    private readonly audit: AuditService,
    private readonly notifications: NotificationsService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    private readonly identityChecks: IdentityChecksService,
  ) {}

  async queue(principal: AuthPrincipal, status?: VerificationStatus) {
    const entries = await this.store.queue({ status, countryCode: reviewerCountryScope(principal) });
    return entries.map((entry) => ({ ...entry, submittedAt: entry.submittedAt?.toISOString() ?? null }));
  }

  async detail(principal: AuthPrincipal, vendorId: string, meta: RequestMeta) {
    const { record, businessName } = await this.load(principal, vendorId);
    await this.audit.record({
      actor: { userId: principal.userId, role: principal.role },
      action: "verification.viewed",
      resourceType: "vendor_verification",
      resourceId: vendorId,
      vendorId,
      countryCode: record.countryCode,
      meta,
    });
    return {
      vendorId,
      businessName,
      countryCode: record.countryCode,
      status: record.status,
      answers: record.answers,
      idNumberLast4: record.idNumberLast4,
      identityCheck: await this.identityChecks.latest("VENDOR", vendorId),
      provider: record.provider,
      submittedAt: record.submittedAt?.toISOString() ?? null,
      decidedAt: record.decidedAt?.toISOString() ?? null,
      decisionReason: record.decisionReason,
    };
  }

  async documentUrl(principal: AuthPrincipal, vendorId: string, slot: DocumentSlot, meta: RequestMeta) {
    const { record } = await this.load(principal, vendorId);
    const fileId = record.answers.documents?.[slot];
    if (!fileId) {
      throw Errors.notFound();
    }
    return this.files.reviewerDownloadUrl(fileId, vendorId, principal, meta);
  }

  async revealIdNumber(principal: AuthPrincipal, vendorId: string, meta: RequestMeta) {
    const { record } = await this.load(principal, vendorId);
    const idNumber = await this.store.revealIdNumber(vendorId);
    await this.audit.record({
      actor: { userId: principal.userId, role: principal.role },
      action: "verification.id_number_revealed",
      resourceType: "vendor_verification",
      resourceId: vendorId,
      vendorId,
      countryCode: record.countryCode,
      meta,
    });
    return { idNumber };
  }

  async decide(principal: AuthPrincipal, vendorId: string, input: VerificationDecisionInput, meta: RequestMeta) {
    const { countryCode } = await this.load(principal, vendorId);
    const scope = reviewerCountryScope(principal);
    const status = DECISION_STATUS[input.decision];
    const activation = await this.prisma.$transaction(async (tx) => {
      const record = await this.store.findLocked(vendorId, tx);
      if (!record || (scope && record.countryCode !== scope)) {
        throw Errors.notFound();
      }
      if (record.status !== "SUBMITTED") {
        throw Errors.invalidTransition("Only submitted verifications can be decided.");
      }
      await this.store.update(vendorId, { status, decidedAt: new Date(), decidedBy: principal.userId, decisionReason: input.reason ?? null }, tx);
      await this.audit.record(
        {
          actor: { userId: principal.userId, role: principal.role },
          action: `verification.${status.toLowerCase()}`,
          resourceType: "vendor_verification",
          resourceId: vendorId,
          vendorId,
          countryCode,
          before: { status: record.status },
          after: { status, reason: input.reason ?? null },
          meta,
        },
        tx,
      );
      return this.activation.refresh(vendorId, countryCode, tx);
    });
    await this.notifyOwner(vendorId, input, activation);
    return { status, vendorActive: activation.vendorActive };
  }

  private async load(principal: AuthPrincipal, vendorId: string): Promise<{ record: VerificationRecord; businessName: string; countryCode: string }> {
    const scope = reviewerCountryScope(principal);
    const vendor = await this.prisma.vendor.findUnique({ where: { id: vendorId } });
    const record = vendor ? await this.store.find(vendorId) : null;
    if (!vendor || !record || !REVIEWABLE_STATUSES.includes(record.status) || (scope && record.countryCode !== scope)) {
      throw Errors.notFound();
    }
    return { record, businessName: vendor.businessName, countryCode: record.countryCode };
  }

  private async notifyOwner(vendorId: string, input: VerificationDecisionInput, activation: ActivationResult): Promise<void> {
    if (activation.activationDue) {
      await this.notices.due(vendorId);
      return;
    }
    const owner = await this.users.findVendorOwner(vendorId);
    const reason = input.reason ?? "";
    const to = owner?.email ?? "";
    const webUrl = this.config.WEB_PUBLIC_URL;
    const message =
      input.decision === "APPROVE"
        ? OnboardingEmails.verificationApproved(to, activation.vendorActive, webUrl)
        : input.decision === "REJECT"
          ? OnboardingEmails.verificationRejected(to, reason)
          : OnboardingEmails.verificationNeedsChanges(to, reason, webUrl);
    await this.notifications.forVendor(vendorId, { title: message.subject, body: message.text, href: "/verification" }).catch(() => undefined);
    if (owner) {
      await this.email.send(message);
    }
  }
}
