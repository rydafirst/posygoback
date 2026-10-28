import { Inject, Injectable } from "@nestjs/common";

import type { AuthPrincipal, RequestMeta } from "../../../common/auth/auth-principal";
import { addDays, startOfUtcDay } from "../../../common/dates";
import { Errors } from "../../../common/http/app-exception";
import { PrismaService } from "../../../database/prisma.service";
import type { FulfilmentPartner, Prisma } from "../../../generated/prisma/client";
import { APP_CONFIG } from "../../../config/config.module";
import type { AppConfig } from "../../../config/config.schema";
import { AuditService } from "../../../infrastructure/audit/audit.service";
import { FieldEncryptionService } from "../../../infrastructure/crypto/field-encryption.service";
import {
  type PartnerCheckKind,
  type PartnerProfileInput,
  partnerProgramme,
  PROOF_MAX_AGE_DAYS,
  type ProofOfAddressInput,
  type RefereeInput,
  type SignAgreementInput,
  type StorageSpaceInput,
  type WorkStatusInput,
} from "../../../shared";
import { FilesService } from "../../files/files.service";
import { actorOf } from "../admin/admin-partners.service";
import { PartnerEmails } from "../partner-emails";
import { sameName } from "../partner-names";
import { StaffAlertsService } from "../../notifications/staff-alerts.service";
import { PartnerNotifierService } from "../partner-notifier.service";
import { PartnersRepository, type StoredProfile } from "../partners.repository";
import { OPEN_PARTNER_STATUSES, PartnerAccessService, partnerIdOf } from "./partner-access.service";
import { signatureColumns } from "../../onboarding/agreements/signatures";

const VERIFYING = ["VERIFYING"] as const;

function addressOf(profile: Partial<Pick<PartnerProfileInput, "addressLines" | "city" | "postalCode">>): string {
  return [...(profile.addressLines ?? []), profile.city ?? "", (profile.postalCode ?? "").replace(/\s/g, "")].map((part) => part.trim().toLowerCase()).join("|");
}
const EDITABLE = ["NOT_STARTED", "SUBMITTED", "REJECTED"] as const;

export function taxIdContext(partnerId: string): string {
  return `partner:${partnerId}:tax-id`;
}

@Injectable()
export class PartnerVerificationService {
  constructor(
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    private readonly prisma: PrismaService,
    private readonly access: PartnerAccessService,
    private readonly partners: PartnersRepository,
    private readonly files: FilesService,
    private readonly encryption: FieldEncryptionService,
    private readonly notifier: PartnerNotifierService,
    private readonly audit: AuditService,
    private readonly staffAlerts: StaffAlertsService,
  ) {}

  async updateProfile(principal: AuthPrincipal, input: PartnerProfileInput, meta: RequestMeta): Promise<void> {
    const purge = await this.access.mutate(principal, VERIFYING, "Your details are locked while we review them.", async (tx, partner) => {
      const previous = (partner.profile ?? {}) as unknown as StoredProfile;
      const reopen: PartnerCheckKind[] = [];
      if (!sameName(previous.fullName, input.fullName)) {
        reopen.push("IDENTITY");
      }
      if (addressOf(previous) !== addressOf(input)) {
        reopen.push("PROOF_OF_ADDRESS", "STORAGE_SPACE");
      }
      const reopened = await tx.partnerCheck.findMany({
        where: { partnerId: partner.id, kind: { in: reopen }, status: { in: ["SUBMITTED", "ACCEPTED"] } },
        select: { id: true, kind: true, fileIds: true },
      });
      if (reopened.length > 0) {
        await tx.partnerCheck.updateMany({
          where: { id: { in: reopened.map((check) => check.id) } },
          data: {
            status: "NOT_STARTED",
            details: {},
            fileIds: [],
            statement: null,
            reviewNote: "Your details changed, so this step needs doing again.",
            reviewedBy: null,
            reviewedAt: null,
            submittedBy: null,
            submittedAt: null,
          },
        });
      }
      await tx.fulfilmentPartner.update({ where: { id: partner.id }, data: { profile: { ...input, heardFrom: previous.heardFrom }, legalName: input.fullName } });
      await this.record(tx, principal, partner, "partner.profile_updated", { reopened: reopened.map((check) => check.kind) }, meta);
      return reopened.flatMap((check) => (check.fileIds as string[] | null) ?? []);
    });
    if (purge.length > 0) {
      await this.files.purge(purge);
    }
  }

  async updateReferee(principal: AuthPrincipal, input: RefereeInput, meta: RequestMeta): Promise<void> {
    await this.access.mutate(principal, VERIFYING, "Your referee is locked while we review your application.", async (tx, partner) => {
      await this.submit(tx, partner.id, "REFERRAL", principal, { details: input });
      await this.record(tx, principal, partner, "partner.referee_updated", {}, meta);
    });
  }

  async submitProofOfAddress(principal: AuthPrincipal, input: ProofOfAddressInput, meta: RequestMeta): Promise<void> {
    const issued = new Date(`${input.issuedOn}T00:00:00Z`);
    const today = startOfUtcDay(new Date());
    if (Number.isNaN(issued.getTime()) || issued > today || issued < addDays(today, -PROOF_MAX_AGE_DAYS)) {
      throw Errors.validation({ issuedOn: ["Use a document dated within the last 3 months"] });
    }
    await this.assertOwnFiles(principal, [input.fileId], "PROOF_OF_ADDRESS", "fileId");
    const replaced = await this.access.mutate(principal, VERIFYING, "Your documents are locked while we review them.", async (tx, partner) => {
      const previous = await tx.partnerCheck.findUniqueOrThrow({ where: { partnerId_kind: { partnerId: partner.id, kind: "PROOF_OF_ADDRESS" } }, select: { fileIds: true } });
      await this.submit(tx, partner.id, "PROOF_OF_ADDRESS", principal, { details: { documentType: input.documentType, issuedOn: input.issuedOn }, fileIds: [input.fileId] });
      await this.record(tx, principal, partner, "partner.proof_of_address_submitted", { documentType: input.documentType }, meta);
      return (previous.fileIds as string[]).filter((id) => id !== input.fileId);
    });
    await this.files.purge(replaced);
  }

  async submitStorageSpace(principal: AuthPrincipal, input: StorageSpaceInput, meta: RequestMeta): Promise<void> {
    const fileIds = [...new Set(input.fileIds)];
    await this.assertOwnFiles(principal, fileIds, "PARTNER_EVIDENCE", "fileIds");
    await this.access.mutate(principal, VERIFYING, "Your documents are locked while we review them.", async (tx, partner) => {
      await this.submit(tx, partner.id, "STORAGE_SPACE", principal, { statement: input.description, fileIds });
      await this.record(tx, principal, partner, "partner.storage_space_submitted", { files: fileIds.length }, meta);
    });
  }

  async submitWorkStatus(principal: AuthPrincipal, input: WorkStatusInput, meta: RequestMeta): Promise<void> {
    await this.access.mutate(principal, VERIFYING, "Your details are locked while we review them.", async (tx, partner) => {
      const country = await tx.country.findUniqueOrThrow({ where: { code: partner.countryCode }, select: { config: true } });
      const rule = partnerProgramme(country.config as { partners?: unknown }).taxId;
      const taxId = input.taxId?.replace(/\s+/g, "") ?? "";
      if (rule.required && !taxId) {
        throw Errors.validation({ taxId: [`Enter your ${rule.label}`] });
      }
      if (taxId && rule.pattern && !new RegExp(rule.pattern).test(taxId)) {
        throw Errors.validation({ taxId: [`That doesn't look like a ${rule.label}`] });
      }
      const details = { declaredAt: new Date().toISOString(), taxIdProvided: Boolean(taxId), ...(taxId ? { taxIdEncrypted: this.encryption.encrypt(taxId, taxIdContext(partner.id)) } : {}) };
      await this.submit(tx, partner.id, "WORK_STATUS", principal, { details }, true);
      await tx.partnerCheck.update({ where: { partnerId_kind: { partnerId: partner.id, kind: "WORK_STATUS" } }, data: { status: "ACCEPTED", reviewedAt: new Date() } });
      await this.record(tx, principal, partner, "partner.work_status_declared", { taxIdProvided: Boolean(taxId) }, meta);
    });
  }

  async signAgreement(principal: AuthPrincipal, input: SignAgreementInput, meta: RequestMeta): Promise<void> {
    await this.access.mutate(principal, OPEN_PARTNER_STATUSES, "This partnership is closed.", async (tx, partner) => {
      const [document] = await this.partners.latestAgreements(partner.countryCode, tx);
      if (!document || document.id !== input.documentId) {
        throw Errors.invalidTransition("A newer version of the agreement has been published. Read the latest version.");
      }
      if (!sameName(input.signature.name, partner.legalName)) {
        throw Errors.validation({ "signature.name": [`Sign with your full name exactly as it appears on your application: ${partner.legalName}`] });
      }
      await tx.partnerAgreementAcceptance.createMany({
        data: [
          {
            partnerId: partner.id,
            legalDocumentId: document.id,
            acceptedBy: principal.userId,
            ip: meta.ip,
            userAgent: meta.userAgent?.slice(0, 512) ?? null,
            ...signatureColumns(input.signature, document.body),
          },
        ],
        skipDuplicates: true,
      });
      await this.record(tx, principal, partner, "partner.agreement_signed", { documentId: document.id, version: document.version, method: input.signature.method }, meta);
    });
  }

  async submitForReview(principal: AuthPrincipal, meta: RequestMeta): Promise<void> {
    const submitted = await this.access.mutate(principal, VERIFYING, "Your application has already been sent.", async (tx, partner) => {
      const checks = await tx.partnerCheck.findMany({ where: { partnerId: partner.id }, select: { kind: true, status: true } });
      const outstanding = checks.filter((check) => check.status === "NOT_STARTED" || check.status === "REJECTED").map((check) => check.kind);
      const [document] = await this.partners.latestAgreements(partner.countryCode, tx);
      const signatures = document ? await tx.partnerAgreementAcceptance.findMany({ where: { partnerId: partner.id, legalDocumentId: document.id }, select: { signatureName: true } }) : [];
      const signed = signatures.filter((signature) => sameName(signature.signatureName, partner.legalName)).length;
      const payout = await tx.partnerPayoutAccount.findUnique({ where: { partnerId: partner.id }, select: { status: true } });
      const problems: Record<string, string[]> = {};
      if (outstanding.length > 0) {
        problems.checks = [`Finish these steps: ${outstanding.map((kind) => kind.toLowerCase().replace(/_/g, " ")).join(", ")}`];
      }
      if (signed === 0) {
        problems.agreement = ["Sign the partner agreement with the name on your application"];
      }
      if (!payout) {
        problems.payoutAccount = ["Set up how you'll be paid"];
      }
      if (Object.keys(problems).length > 0) {
        throw Errors.validation(problems);
      }
      await tx.fulfilmentPartner.update({ where: { id: partner.id }, data: { status: "UNDER_REVIEW", statusReason: null } });
      await this.record(tx, principal, partner, "partner.submitted_for_review", {}, meta);
      return partner;
    });
    await this.notifier.notify(partnerIdOf(principal), PartnerEmails.applicationSubmitted);
    await this.staffAlerts.raise("partners", {
      countryCode: submitted.countryCode,
      title: `${submitted.legalName} is ready for review`,
      body: `Partner application ${submitted.reference} has every step done and is waiting for a decision.`,
    });
  }

  private async submit(
    tx: Prisma.TransactionClient,
    partnerId: string,
    kind: PartnerCheckKind,
    principal: AuthPrincipal,
    values: { details?: Prisma.InputJsonValue; fileIds?: string[]; statement?: string },
    reopen = false,
  ): Promise<void> {
    const updated = await tx.partnerCheck.updateMany({
      where: { partnerId, kind, status: { in: reopen ? [...EDITABLE, "ACCEPTED"] : [...EDITABLE] } },
      data: {
        status: "SUBMITTED",
        details: values.details ?? {},
        fileIds: values.fileIds ?? [],
        statement: values.statement ?? null,
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
  }

  private async assertOwnFiles(principal: AuthPrincipal, fileIds: string[], purpose: "PROOF_OF_ADDRESS" | "PARTNER_EVIDENCE", field: string): Promise<void> {
    const statuses = await this.files.uploadedBy(principal.userId, fileIds, purpose);
    if (fileIds.some((id) => statuses.get(id) !== "VERIFIED")) {
      throw Errors.validation({ [field]: ["Upload each file and wait for it to be checked"] });
    }
  }

  private record(tx: Prisma.TransactionClient, principal: AuthPrincipal, partner: FulfilmentPartner, action: string, after: Record<string, unknown>, meta: RequestMeta) {
    return this.audit.record({ actor: actorOf(principal), action, resourceType: "fulfilment_partner", resourceId: partner.id, countryCode: partner.countryCode, after, meta }, tx);
  }
}
