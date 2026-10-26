import { Inject, Injectable } from "@nestjs/common";
import { buildVerificationSchemas, DOCUMENT_SLOTS, EDITABLE_VERIFICATION_STATUSES, hasPermission, type VerificationMarket, type VerificationView } from "../../../shared";
import type { ZodError } from "zod";

import type { AuthPrincipal, RequestMeta } from "../../../common/auth/auth-principal";
import { Errors } from "../../../common/http/app-exception";
import { PrismaService } from "../../../database/prisma.service";
import { AuditService } from "../../../infrastructure/audit/audit.service";
import { EMAIL_SENDER, type EmailSender } from "../../../infrastructure/email/email.port";
import { UsersRepository } from "../../auth/users.repository";
import { CountriesRepository } from "../../countries/countries.repository";
import { FilesService } from "../../files/files.service";
import { OnboardingEmails } from "../onboarding-emails";
import { todayIso, vendorIdOf } from "../scope";
import { IdentityProviderRegistry } from "./identity-provider";
import { type VerificationAnswers, type VerificationRecord, VerificationStore } from "./verification.store";

function fieldErrorsOf(error: ZodError): Record<string, string[]> {
  const result: Record<string, string[]> = {};
  for (const issue of error.issues) {
    const key = issue.path.map(String).join(".") || "_";
    result[key] = [...(result[key] ?? []), issue.message];
  }
  return result;
}

function documentIds(answers: VerificationAnswers): string[] {
  return DOCUMENT_SLOTS.map((slot) => answers.documents?.[slot]).filter((id): id is string => Boolean(id));
}

@Injectable()
export class VendorVerificationService {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(EMAIL_SENDER) private readonly email: EmailSender,
    private readonly store: VerificationStore,
    private readonly countries: CountriesRepository,
    private readonly files: FilesService,
    private readonly providers: IdentityProviderRegistry,
    private readonly users: UsersRepository,
    private readonly audit: AuditService,
  ) {}

  async view(principal: AuthPrincipal): Promise<VerificationView> {
    const vendorId = vendorIdOf(principal);
    const market = await this.marketOf(principal);
    const record = await this.store.find(vendorId);
    const view = await this.toView(vendorId, market, record);
    return hasPermission(principal.role, "vendor.verification.manage") ? view : { ...view, draft: {}, idNumberLast4: null, documents: [] };
  }

  async saveDraft(principal: AuthPrincipal, input: unknown, meta: RequestMeta): Promise<VerificationView> {
    const vendorId = vendorIdOf(principal);
    const market = await this.marketOf(principal);
    const parsed = buildVerificationSchemas(market, todayIso()).draft.safeParse(input);
    if (!parsed.success) {
      throw Errors.validation(fieldErrorsOf(parsed.error));
    }
    const { idNumber, ...answers } = parsed.data;
    await this.assertOwnFiles(vendorId, answers);
    await this.prisma.$transaction(async (tx) => {
      const existing = await this.store.findLocked(vendorId, tx);
      const status = existing?.status ?? "NOT_STARTED";
      if (!EDITABLE_VERIFICATION_STATUSES.includes(status)) {
        throw Errors.invalidTransition("Your verification is with our reviewers and can't be changed right now.");
      }
      const merged = mergeAnswers(existing?.answers ?? {}, answers);
      await this.store.save({ vendorId, countryCode: market.countryCode, status: status === "RESUBMISSION_REQUIRED" ? status : "IN_PROGRESS", answers: merged }, idNumber, tx);
      await this.audit.record(
        {
          actor: { userId: principal.userId, role: principal.role },
          action: "verification.draft_saved",
          resourceType: "vendor_verification",
          resourceId: vendorId,
          vendorId,
          countryCode: market.countryCode,
          meta,
        },
        tx,
      );
    });
    return this.view(principal);
  }

  async submit(principal: AuthPrincipal, meta: RequestMeta): Promise<VerificationView> {
    const vendorId = vendorIdOf(principal);
    const market = await this.marketOf(principal);
    await this.prisma.$transaction(async (tx) => {
      const record = await this.store.findLocked(vendorId, tx);
      if (!record || !EDITABLE_VERIFICATION_STATUSES.includes(record.status)) {
        throw Errors.invalidTransition("There's nothing to submit right now.");
      }
      const idNumber = record.hasIdNumber ? await this.store.revealIdNumber(vendorId) : undefined;
      const parsed = buildVerificationSchemas(market, todayIso()).submission.safeParse({ ...record.answers, idNumber });
      if (!parsed.success) {
        throw Errors.validation(fieldErrorsOf(parsed.error));
      }
      const statuses = await this.files.vendorFiles(vendorId, documentIds(record.answers), "KYC_DOCUMENT");
      const missing = documentIds(record.answers).filter((id) => statuses.get(id) !== "VERIFIED");
      if (missing.length > 0) {
        throw Errors.validation({ documents: ["Some documents are missing or still being checked. Upload them again."] });
      }
      const receipt = await this.providers.for(market.kyc).submit({ vendorId, countryCode: market.countryCode });
      await this.store.update(vendorId, { status: "SUBMITTED", submittedAt: new Date(), provider: receipt.provider, providerReference: receipt.reference, decisionReason: null }, tx);
      await this.audit.record(
        {
          actor: { userId: principal.userId, role: principal.role },
          action: "verification.submitted",
          resourceType: "vendor_verification",
          resourceId: vendorId,
          vendorId,
          countryCode: market.countryCode,
          after: { provider: receipt.provider },
          meta,
        },
        tx,
      );
    });
    const owner = await this.users.findById(principal.userId);
    if (owner) {
      await this.email.send(OnboardingEmails.verificationReceived(owner.email));
    }
    return this.view(principal);
  }

  async marketOf(principal: AuthPrincipal): Promise<VerificationMarket> {
    const country = await this.countries.findByCode(principal.countryCode ?? "");
    if (!country) {
      throw Errors.notFound();
    }
    return { countryCode: country.code, kyc: country.config.kyc, address: country.config.address };
  }

  private async assertOwnFiles(vendorId: string, answers: VerificationAnswers): Promise<void> {
    const ids = documentIds(answers);
    const owned = await this.files.vendorFiles(vendorId, ids, "KYC_DOCUMENT");
    if (ids.some((id) => !owned.has(id))) {
      throw Errors.validation({ documents: ["Upload documents through the verification page."] });
    }
  }

  private async toView(vendorId: string, market: VerificationMarket, record: VerificationRecord | null): Promise<VerificationView> {
    const answers = record?.answers ?? {};
    const statuses = await this.files.vendorFiles(vendorId, documentIds(answers), "KYC_DOCUMENT");
    return {
      status: record?.status ?? "NOT_STARTED",
      market,
      draft: answers as VerificationView["draft"],
      idNumberLast4: record?.idNumberLast4 ?? null,
      documents: DOCUMENT_SLOTS.flatMap((slot) => {
        const fileId = answers.documents?.[slot];
        const status = fileId ? statuses.get(fileId) : undefined;
        return fileId && status ? [{ slot, fileId, status }] : [];
      }),
      submittedAt: record?.submittedAt?.toISOString() ?? null,
      decisionReason: record?.decisionReason ?? null,
    };
  }
}

function mergeAnswers(existing: VerificationAnswers, incoming: VerificationAnswers): VerificationAnswers {
  return { ...existing, ...incoming, registeredAddress: { ...existing.registeredAddress, ...incoming.registeredAddress }, documents: { ...existing.documents, ...incoming.documents } };
}
