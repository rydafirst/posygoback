import { Injectable } from "@nestjs/common";

import { type DatabaseClient, PrismaService } from "../../../database/prisma.service";
import type { LegalDocument, Prisma } from "../../../generated/prisma/client";
import type { LegalDocumentKind, LegalDocumentView } from "../../../shared";

type LegalDocumentRow = LegalDocument;

const NEWEST_FIRST = [{ publishedAt: "desc" }, { id: "desc" }] satisfies Prisma.LegalDocumentOrderByWithRelationInput[];

export function toLegalView(row: LegalDocumentRow): LegalDocumentView {
  return { id: row.id, countryCode: row.countryCode, kind: row.kind, version: row.version, title: row.title, body: row.body, publishedAt: row.publishedAt.toISOString() };
}

@Injectable()
export class LegalDocumentsRepository {
  constructor(private readonly prisma: PrismaService) {}

  async latest(countryCode: string, kind: LegalDocumentKind, client: DatabaseClient = this.prisma): Promise<LegalDocumentRow | undefined> {
    return (await client.legalDocument.findFirst({ where: { countryCode, kind }, orderBy: NEWEST_FIRST })) ?? undefined;
  }

  latestPerKind(countryCode: string, kinds: readonly LegalDocumentKind[], client: DatabaseClient = this.prisma): Promise<LegalDocumentRow[]> {
    return client.legalDocument.findMany({ where: { countryCode, kind: { in: [...kinds] } }, distinct: ["kind"], orderBy: [{ kind: "asc" }, ...NEWEST_FIRST] });
  }

  async findById(id: string): Promise<LegalDocumentRow | undefined> {
    return (await this.prisma.legalDocument.findUnique({ where: { id } })) ?? undefined;
  }

  list(countryCode?: string): Promise<LegalDocumentRow[]> {
    return this.prisma.legalDocument.findMany({ where: countryCode ? { countryCode } : {}, orderBy: [{ countryCode: "asc" }, { kind: "asc" }, { publishedAt: "desc" }], take: 500 });
  }

  async insert(values: Prisma.LegalDocumentUncheckedCreateInput, client: DatabaseClient): Promise<LegalDocumentRow | undefined> {
    const [row] = await client.legalDocument.createManyAndReturn({ data: [values], skipDuplicates: true });
    return row;
  }

  async acceptances(vendorId: string, documentIds: readonly string[], client: DatabaseClient = this.prisma): Promise<Map<string, Date>> {
    if (documentIds.length === 0) {
      return new Map();
    }
    const rows = await client.agreementAcceptance.findMany({ where: { vendorId, legalDocumentId: { in: [...documentIds] } }, select: { legalDocumentId: true, acceptedAt: true } });
    return new Map(rows.map((row) => [row.legalDocumentId, row.acceptedAt]));
  }

  async accept(values: Prisma.AgreementAcceptanceUncheckedCreateInput, client: DatabaseClient): Promise<void> {
    await client.agreementAcceptance.createMany({ data: [values], skipDuplicates: true });
  }
}
