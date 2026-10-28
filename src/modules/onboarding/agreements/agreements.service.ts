import { Injectable } from "@nestjs/common";
import { type AcceptAgreementInput, type CreateLegalDocumentInput, type LegalDocumentKind, type LegalDocumentView, type RequiredAgreementView, VENDOR_LEGAL_KINDS } from "../../../shared";

import type { AuthPrincipal, RequestMeta } from "../../../common/auth/auth-principal";
import { Errors } from "../../../common/http/app-exception";
import { PrismaService } from "../../../database/prisma.service";
import { AuditService } from "../../../infrastructure/audit/audit.service";
import { CountriesRepository } from "../../countries/countries.repository";
import { ActivationNoticesService } from "../activation/activation-notices.service";
import { vendorIdOf } from "../scope";
import { VendorActivationService } from "../vendor-activation.service";
import { LegalDocumentsRepository, toLegalView } from "./legal-documents.repository";
import { signatureColumns, toCertificate } from "./signatures";

const SIGNED_KINDS: readonly LegalDocumentKind[] = ["VENDOR_AGREEMENT"];

@Injectable()
export class AgreementsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly legal: LegalDocumentsRepository,
    private readonly countries: CountriesRepository,
    private readonly activation: VendorActivationService,
    private readonly notices: ActivationNoticesService,
    private readonly audit: AuditService,
  ) {}

  async requiredFor(principal: AuthPrincipal): Promise<RequiredAgreementView[]> {
    const vendorId = vendorIdOf(principal);
    const documents = await this.legal.latestPerKind(principal.countryCode ?? "", VENDOR_LEGAL_KINDS);
    const accepted = await this.legal.acceptances(
      vendorId,
      documents.map((document) => document.id),
    );
    return documents.map((document) => {
      const acceptance = accepted.get(document.id);
      return {
        document: toLegalView(document),
        acceptedAt: acceptance?.acceptedAt.toISOString() ?? null,
        certificate: acceptance ? toCertificate(acceptance, document, acceptance.acceptor.email) : null,
      };
    });
  }

  async accept(principal: AuthPrincipal, documentId: string, input: AcceptAgreementInput, meta: RequestMeta): Promise<{ vendorActive: boolean }> {
    const vendorId = vendorIdOf(principal);
    const document = await this.legal.findById(documentId);
    if (!document || document.countryCode !== principal.countryCode || !VENDOR_LEGAL_KINDS.includes(document.kind)) {
      throw Errors.notFound();
    }
    const latest = await this.legal.latest(document.countryCode, document.kind);
    if (latest?.id !== document.id) {
      throw Errors.invalidTransition("A newer version of this document has been published. Review the latest version.");
    }
    if (SIGNED_KINDS.includes(document.kind) && !input.signature) {
      throw Errors.validation({ signature: ["Sign the agreement to accept it."] });
    }
    const signature = input.signature ? signatureColumns(input.signature, document.body) : {};
    const result = await this.prisma.$transaction(async (tx) => {
      await this.legal.accept({ vendorId, legalDocumentId: document.id, acceptedBy: principal.userId, ip: meta.ip, userAgent: meta.userAgent, ...signature }, tx);
      await this.audit.record(
        {
          actor: { userId: principal.userId, role: principal.role },
          action: "agreement.accepted",
          resourceType: "legal_document",
          resourceId: document.id,
          vendorId,
          countryCode: document.countryCode,
          after: { kind: document.kind, version: document.version, signed: Boolean(input.signature), method: input.signature?.method ?? null },
          meta,
        },
        tx,
      );
      return this.activation.refresh(vendorId, document.countryCode, tx);
    });
    if (result.activationDue) {
      await this.notices.due(vendorId);
    }
    return { vendorActive: result.vendorActive };
  }

  async publicLatest(countryCode: string, kind: LegalDocumentKind): Promise<LegalDocumentView> {
    const document = await this.legal.latest(countryCode, kind);
    if (!document) {
      throw Errors.notFound();
    }
    return toLegalView(document);
  }

  async list(countryCode?: string): Promise<LegalDocumentView[]> {
    return (await this.legal.list(countryCode)).map(toLegalView);
  }

  async publish(input: CreateLegalDocumentInput, principal: AuthPrincipal, meta: RequestMeta): Promise<LegalDocumentView> {
    if (!(await this.countries.findByCode(input.countryCode))) {
      throw Errors.notFound("Country not found.");
    }
    return this.prisma.$transaction(async (tx) => {
      const created = await this.legal.insert({ ...input, createdBy: principal.userId }, tx);
      if (!created) {
        throw Errors.invalidTransition("That version already exists. Use a new version number.");
      }
      await this.audit.record(
        {
          actor: { userId: principal.userId, role: principal.role },
          action: "legal_document.published",
          resourceType: "legal_document",
          resourceId: created.id,
          countryCode: created.countryCode,
          after: { kind: created.kind, version: created.version, title: created.title },
          meta,
        },
        tx,
      );
      return toLegalView(created);
    });
  }
}
