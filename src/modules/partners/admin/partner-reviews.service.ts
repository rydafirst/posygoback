import { Injectable } from "@nestjs/common";

import type { AuthPrincipal, RequestMeta } from "../../../common/auth/auth-principal";
import { Errors } from "../../../common/http/app-exception";
import { lockRow, PrismaService } from "../../../database/prisma.service";
import type { Prisma } from "../../../generated/prisma/client";
import { AuditService } from "../../../infrastructure/audit/audit.service";
import { type PartnerCheckKind, type PartnerDetailView, REVIEWED_CHECKS, type ReviewCheckInput } from "../../../shared";
import { FilesService } from "../../files/files.service";
import { PartnerEmails } from "../partner-emails";
import { PartnerNotifierService } from "../partner-notifier.service";
import { actorOf, AdminPartnersService } from "./admin-partners.service";

const REVIEWABLE_STATUSES = ["VERIFYING", "UNDER_REVIEW"] as const;

@Injectable()
export class PartnerReviewsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly admin: AdminPartnersService,
    private readonly files: FilesService,
    private readonly notifier: PartnerNotifierService,
    private readonly audit: AuditService,
  ) {}

  async reviewCheck(principal: AuthPrincipal, partnerId: string, kind: PartnerCheckKind, input: ReviewCheckInput, meta: RequestMeta): Promise<PartnerDetailView> {
    if (!REVIEWED_CHECKS.includes(kind)) {
      throw Errors.notFound();
    }
    if (kind === "PROOF_OF_ADDRESS" && input.accept && input.addressMatches !== true) {
      throw Errors.validation({ addressMatches: ["Confirm the document shows the storage address before accepting it"] });
    }
    const partner = await this.admin.scoped(principal, partnerId);
    await this.inReview(partnerId, async (tx) => {
      const check = await tx.partnerCheck.findUnique({ where: { partnerId_kind: { partnerId, kind } } });
      if (!check || check.status !== "SUBMITTED") {
        throw Errors.invalidTransition("There's nothing waiting for review in this step.");
      }
      if (check.submittedBy === principal.userId) {
        throw Errors.forbidden("Someone else must review a step you submitted.");
      }
      const status = input.accept ? "ACCEPTED" : "REJECTED";
      await tx.partnerCheck.update({ where: { id: check.id }, data: { status, reviewedBy: principal.userId, reviewedAt: new Date(), reviewNote: input.note } });
      await this.audit.record(
        {
          actor: actorOf(principal),
          action: `partner.check_${status.toLowerCase()}`,
          resourceType: "fulfilment_partner",
          resourceId: partnerId,
          countryCode: partner.countryCode,
          after: { kind, note: input.note },
          meta,
        },
        tx,
      );
    });
    await this.notifier.notify(partnerId, (to, webUrl) => PartnerEmails.checkReviewed(to, kind, input.accept, webUrl));
    return this.admin.detail(principal, partnerId);
  }

  async scheduleCall(principal: AuthPrincipal, partnerId: string, scheduledAt: string, meta: RequestMeta): Promise<PartnerDetailView> {
    const partner = await this.admin.scoped(principal, partnerId);
    const when = new Date(scheduledAt);
    if (when.getTime() < Date.now()) {
      throw Errors.validation({ scheduledAt: ["Choose a time in the future"] });
    }
    await this.inReview(partnerId, async (tx) => {
      await tx.partnerCheck.update({ where: { partnerId_kind: { partnerId, kind: "STORAGE_SPACE" } }, data: { callScheduledAt: when, callOutcome: null, callRecordedBy: null } });
      await this.audit.record(
        { actor: actorOf(principal), action: "partner.call_scheduled", resourceType: "fulfilment_partner", resourceId: partnerId, countryCode: partner.countryCode, after: { scheduledAt }, meta },
        tx,
      );
    });
    await this.notifier.notify(partnerId, (to, webUrl) => PartnerEmails.callScheduled(to, when, webUrl));
    return this.admin.detail(principal, partnerId);
  }

  async recordCall(principal: AuthPrincipal, partnerId: string, outcome: string, meta: RequestMeta): Promise<PartnerDetailView> {
    const partner = await this.admin.scoped(principal, partnerId);
    await this.inReview(partnerId, async (tx) => {
      const check = await tx.partnerCheck.findUnique({ where: { partnerId_kind: { partnerId, kind: "STORAGE_SPACE" } } });
      if (!check?.callScheduledAt) {
        throw Errors.invalidTransition("Schedule the call first.");
      }
      await tx.partnerCheck.update({ where: { id: check.id }, data: { callOutcome: outcome, callRecordedBy: principal.userId } });
      await this.audit.record(
        { actor: actorOf(principal), action: "partner.call_recorded", resourceType: "fulfilment_partner", resourceId: partnerId, countryCode: partner.countryCode, after: { outcome }, meta },
        tx,
      );
    });
    return this.admin.detail(principal, partnerId);
  }

  async reviewInsurance(principal: AuthPrincipal, partnerId: string, policyId: string, input: ReviewCheckInput, meta: RequestMeta): Promise<PartnerDetailView> {
    const partner = await this.admin.scoped(principal, partnerId);
    await this.prisma.$transaction(async (tx) => {
      const policy = await tx.partnerInsurancePolicy.findFirst({ where: { id: policyId, partnerId } });
      if (!policy) {
        throw Errors.notFound();
      }
      if (policy.uploadedBy === principal.userId) {
        throw Errors.forbidden("Someone else must review a policy you uploaded.");
      }
      const status = input.accept ? "VERIFIED" : "REJECTED";
      const updated = await tx.partnerInsurancePolicy.updateMany({
        where: { id: policyId, status: "PENDING" },
        data: { status, reviewedBy: principal.userId, reviewedAt: new Date(), reviewNote: input.note },
      });
      if (updated.count === 0) {
        throw Errors.invalidTransition("This policy has already been reviewed.");
      }
      await this.audit.record(
        {
          actor: actorOf(principal),
          action: `partner.insurance_${status.toLowerCase()}`,
          resourceType: "partner_insurance_policy",
          resourceId: policyId,
          countryCode: partner.countryCode,
          after: { note: input.note },
          meta,
        },
        tx,
      );
    });
    await this.notifier.notify(partnerId, (to, webUrl) => PartnerEmails.insuranceReviewed(to, input.accept, input.note, webUrl));
    return this.admin.detail(principal, partnerId);
  }

  async evidenceUrl(principal: AuthPrincipal, partnerId: string, fileId: string, meta: RequestMeta) {
    await this.admin.scoped(principal, partnerId);
    const checks = await this.prisma.partnerCheck.findMany({ where: { partnerId, filesPurgedAt: null }, select: { kind: true, fileIds: true } });
    const linked = checks.find((check) => (check.fileIds as string[]).includes(fileId));
    if (linked) {
      return this.files.linkedDownloadUrl(fileId, linked.kind === "PROOF_OF_ADDRESS" ? "PROOF_OF_ADDRESS" : "PARTNER_EVIDENCE", principal, meta);
    }
    if (await this.prisma.partnerInsurancePolicy.findFirst({ where: { partnerId, fileId }, select: { id: true } })) {
      return this.files.linkedDownloadUrl(fileId, "PARTNER_EVIDENCE", principal, meta);
    }
    if (await this.prisma.stockCount.findFirst({ where: { partnerId, videoFileId: fileId }, select: { id: true } })) {
      return this.files.linkedDownloadUrl(fileId, "STOCK_COUNT", principal, meta);
    }
    throw Errors.notFound();
  }

  private inReview(partnerId: string, work: (tx: Prisma.TransactionClient) => Promise<void>): Promise<void> {
    return this.prisma.$transaction(async (tx) => {
      await lockRow(tx, "fulfilmentPartners", partnerId);
      const current = await tx.fulfilmentPartner.findUniqueOrThrow({ where: { id: partnerId }, select: { status: true } });
      if (!(REVIEWABLE_STATUSES as readonly string[]).includes(current.status)) {
        throw Errors.invalidTransition("Verification steps are reviewed before approval.");
      }
      await work(tx);
    });
  }
}
