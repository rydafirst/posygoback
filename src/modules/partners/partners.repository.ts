import { Injectable } from "@nestjs/common";

import { Errors } from "../../common/http/app-exception";
import { type DatabaseClient, PrismaService } from "../../database/prisma.service";
import type { Prisma } from "../../generated/prisma/client";
import {
  type ActivationReadiness,
  decisionsFrom,
  type HeardFrom,
  type InsurancePolicyView,
  PARTNER_CHECK_KINDS,
  PARTNER_LEGAL_KINDS,
  type PartnerCheckView,
  type PartnerDetailView,
  type PartnerProfileInput,
  partnerProgramme,
  type PartnerSummaryView,
  type SecurityView,
  tierFor,
} from "../../shared";

const SUMMARY_INCLUDE = { warehouses: { select: { id: true, code: true, name: true }, orderBy: { code: "asc" } } } satisfies Prisma.FulfilmentPartnerInclude;

const DETAIL_INCLUDE = {
  ...SUMMARY_INCLUDE,
  country: { select: { currency: true, config: true } },
  checks: true,
  acceptances: { include: { document: { select: { id: true, kind: true, version: true, title: true } } } },
  insurance: { orderBy: { createdAt: "desc" }, take: 20 },
  securities: { orderBy: { receivedAt: "desc" }, include: { draws: { select: { amountMinor: true } } } },
  payoutAccount: true,
  users: { select: { id: true, email: true, role: true, status: true }, orderBy: { email: "asc" } },
  invitations: { where: { status: "PENDING" }, select: { id: true, email: true, role: true, expiresAt: true }, orderBy: { createdAt: "asc" } },
} satisfies Prisma.FulfilmentPartnerInclude;

export type PartnerSummaryRow = Prisma.FulfilmentPartnerGetPayload<{ include: typeof SUMMARY_INCLUDE }>;
export type PartnerDetailRow = Prisma.FulfilmentPartnerGetPayload<{ include: typeof DETAIL_INCLUDE }>;

type PartnerRole = "FULFILMENT_PARTNER" | "PARTNER_STAFF";

export interface StoredProfile extends PartnerProfileInput {
  heardFrom?: HeardFrom;
}

const PUBLIC_DETAIL_KEYS = ["name", "contact", "relationship", "documentType", "issuedOn", "taxIdProvided", "declaredAt", "provider", "failureReason"] as const;

function isoDay(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function publicDetails(details: unknown): Record<string, string | boolean | null> {
  const source = (details ?? {}) as Record<string, unknown>;
  const visible: Record<string, string | boolean | null> = {};
  for (const key of PUBLIC_DETAIL_KEYS) {
    const value = source[key];
    if (typeof value === "string" || typeof value === "boolean") {
      visible[key] = value;
    }
  }
  return visible;
}

export function toPartnerSummary(row: PartnerSummaryRow): PartnerSummaryView {
  const profile = row.profile as StoredProfile | null;
  return {
    id: row.id,
    reference: row.reference,
    legalName: row.legalName,
    kind: row.kind,
    countryCode: row.countryCode,
    city: profile?.city ?? null,
    status: row.status,
    tierLevel: row.tierLevel,
    founding: row.founding,
    warehouses: row.warehouses,
    createdAt: row.createdAt.toISOString(),
  };
}

@Injectable()
export class PartnersRepository {
  constructor(private readonly prisma: PrismaService) {}

  list(where: Prisma.FulfilmentPartnerWhereInput): Promise<PartnerSummaryRow[]> {
    return this.prisma.fulfilmentPartner.findMany({ where, include: SUMMARY_INCLUDE, orderBy: { createdAt: "desc" }, take: 200 });
  }

  async detail(id: string, scope: Prisma.FulfilmentPartnerWhereInput = {}, client: DatabaseClient = this.prisma): Promise<PartnerDetailRow> {
    const row = await client.fulfilmentPartner.findFirst({ where: { id, ...scope }, include: DETAIL_INCLUDE });
    if (!row) {
      throw Errors.notFound();
    }
    return row;
  }

  latestAgreements(countryCode: string, client: DatabaseClient = this.prisma) {
    return client.legalDocument.findMany({
      where: { countryCode, kind: { in: [...PARTNER_LEGAL_KINDS] } },
      distinct: ["kind"],
      orderBy: [{ kind: "asc" }, { publishedAt: "desc" }, { id: "desc" }],
      select: { id: true, kind: true, version: true, title: true, body: true },
    });
  }

  async heldStockValue(partnerId: string, client: DatabaseClient = this.prisma): Promise<number> {
    const [row] = await client.$queryRaw<Array<{ value: bigint }>>`
      SELECT COALESCE(SUM((lot.quantity_available + lot.quantity_reserved)::bigint * product.declared_value_minor), 0)::bigint AS value
      FROM stock_lots lot
      JOIN warehouses warehouse ON warehouse.id = lot.warehouse_id
      JOIN products product ON product.id = lot.product_id
      WHERE warehouse.partner_id = ${partnerId}::uuid`;
    return Number(row?.value ?? 0n);
  }

  async view(row: PartnerDetailRow, readiness: ActivationReadiness, client: DatabaseClient = this.prisma): Promise<PartnerDetailView> {
    const latest = await this.latestAgreements(row.countryCode, client);
    const signed = new Map(row.acceptances.map((acceptance) => [acceptance.legalDocumentId, acceptance]));
    const checks = new Map(row.checks.map((check) => [check.kind, check]));
    const programme = partnerProgramme(row.country.config as { partners?: unknown });
    const tier = tierFor(programme, row.tierLevel);
    const profile = row.profile as StoredProfile | null;
    const { heardFrom = null, ...profileFields } = profile ?? ({} as StoredProfile);
    return {
      ...toPartnerSummary(row),
      contactEmail: row.contactEmail,
      profile: profile ? profileFields : null,
      heardFrom,
      statusReason: row.statusReason,
      currency: row.country.currency,
      requiredDepositMinor: Number(row.requiredDepositMinor),
      requiredInsuranceMinor: Number(row.requiredInsuranceMinor),
      tier: { level: tier.level, name: tier.name, maxStockValueMinor: tier.maxStockValueMinor, maxItemValueMinor: tier.maxItemValueMinor },
      heldStockValueMinor: await this.heldStockValue(row.id, client),
      workStatus: { taxIdLabel: programme.taxId.label, taxIdRequired: programme.taxId.required, declaration: programme.workDeclaration },
      checks: PARTNER_CHECK_KINDS.map((kind): PartnerCheckView => {
        const check = checks.get(kind);
        return {
          kind,
          status: check?.status ?? "NOT_STARTED",
          details: publicDetails(check?.details),
          statement: check?.statement ?? null,
          fileIds: check?.filesPurgedAt ? [] : ((check?.fileIds as string[] | undefined) ?? []),
          filesPurged: Boolean(check?.filesPurgedAt),
          reviewNote: check?.reviewNote ?? null,
          submittedAt: check?.submittedAt?.toISOString() ?? null,
          reviewedAt: check?.reviewedAt?.toISOString() ?? null,
          callScheduledAt: check?.callScheduledAt?.toISOString() ?? null,
          callOutcome: check?.callOutcome ?? null,
        };
      }),
      agreements: PARTNER_LEGAL_KINDS.map((kind) => {
        const document = latest.find((candidate) => candidate.kind === kind);
        const signature = document ? signed.get(document.id) : undefined;
        return {
          kind,
          documentId: document?.id ?? null,
          title: document?.title ?? null,
          version: document?.version ?? null,
          signedAt: signature?.acceptedAt.toISOString() ?? null,
          signatureName: signature?.signatureName ?? null,
        };
      }),
      insurance: row.insurance.map((policy): InsurancePolicyView => ({
        id: policy.id,
        insurer: policy.insurer,
        policyNumber: policy.policyNumber,
        coverMinor: Number(policy.coverMinor),
        currency: policy.currency,
        startsOn: isoDay(policy.startsOn),
        expiresOn: isoDay(policy.expiresOn),
        fileId: policy.fileId,
        status: policy.status,
        reviewNote: policy.reviewNote,
      })),
      securities: row.securities.map((security): SecurityView => ({
        id: security.id,
        kind: security.kind,
        amountMinor: Number(security.amountMinor),
        drawnMinor: security.draws.reduce((total, draw) => total + Number(draw.amountMinor), 0),
        currency: security.currency,
        reference: security.reference,
        receivedAt: security.receivedAt.toISOString(),
        expiresOn: security.expiresOn ? isoDay(security.expiresOn) : null,
        confirmedAt: security.confirmedAt?.toISOString() ?? null,
        releasedAt: security.releasedAt?.toISOString() ?? null,
      })),
      payoutAccount: row.payoutAccount
        ? {
            provider: row.payoutAccount.provider,
            status: row.payoutAccount.status,
            bankSummary: row.payoutAccount.bankSummary,
            detailsChangedAt: row.payoutAccount.detailsChangedAt?.toISOString() ?? null,
          }
        : null,
      readiness,
      decisions: decisionsFrom(row.status),
      team: row.users.map((user) => ({ userId: user.id, email: user.email, role: user.role as PartnerRole, status: user.status })),
      pendingInvitations: row.invitations
        .filter((invitation) => invitation.expiresAt > new Date())
        .map((invitation) => ({ id: invitation.id, email: invitation.email, role: invitation.role as PartnerRole, expiresAt: invitation.expiresAt.toISOString() })),
    };
  }
}
