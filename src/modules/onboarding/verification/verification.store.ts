import { Injectable } from "@nestjs/common";

import { type DatabaseClient, lockRow, PrismaService } from "../../../database/prisma.service";
import type { Prisma, VendorVerification, VerificationStatus } from "../../../generated/prisma/client";
import { FieldEncryptionService } from "../../../infrastructure/crypto/field-encryption.service";

export type { VerificationStatus };

export interface VerificationAnswers {
  businessType?: string;
  legalBusinessName?: string;
  registrationCountryCode?: string;
  companyNumber?: string;
  taxNumber?: string;
  registeredAddress?: { line1?: string; line2?: string; city?: string; region?: string; postalCode?: string };
  contactFullName?: string;
  contactRole?: string;
  contactPhone?: string;
  idType?: string;
  idExpiry?: string;
  documents?: { idFront?: string; idBack?: string; selfie?: string; businessDocument?: string };
  productsDescription?: string;
  monthlyUnits?: string;
  monthlyOrders?: string;
  hazards?: string[];
}

export const REVIEWABLE_STATUSES: readonly VerificationStatus[] = ["SUBMITTED", "APPROVED", "REJECTED", "RESUBMISSION_REQUIRED"];

export interface VerificationRecord {
  vendorId: string;
  countryCode: string;
  status: VerificationStatus;
  answers: VerificationAnswers;
  idNumberLast4: string | null;
  provider: string | null;
  submittedAt: Date | null;
  decidedAt: Date | null;
  decisionReason: string | null;
}

export interface QueueEntry {
  vendorId: string;
  businessName: string;
  countryCode: string;
  status: VerificationStatus;
  submittedAt: Date | null;
}

const answersContext = (vendorId: string) => `vendor:${vendorId}:verification-answers`;
const idNumberContext = (vendorId: string) => `vendor:${vendorId}:id-number`;

@Injectable()
export class VerificationStore {
  constructor(
    private readonly prisma: PrismaService,
    private readonly encryption: FieldEncryptionService,
  ) {}

  async find(vendorId: string, client: DatabaseClient = this.prisma): Promise<VerificationRecord | null> {
    const row = await client.vendorVerification.findUnique({ where: { vendorId } });
    return row ? this.toRecord(row) : null;
  }

  async findLocked(vendorId: string, tx: Prisma.TransactionClient): Promise<VerificationRecord | null> {
    return (await lockRow(tx, "vendorVerifications", vendorId)) ? this.find(vendorId, tx) : null;
  }

  async save(record: Pick<VerificationRecord, "vendorId" | "countryCode" | "status" | "answers">, client: DatabaseClient): Promise<void> {
    const answersEncrypted = this.encryption.encrypt(JSON.stringify(record.answers), answersContext(record.vendorId));
    await client.vendorVerification.upsert({
      where: { vendorId: record.vendorId },
      create: { vendorId: record.vendorId, countryCode: record.countryCode, status: record.status, answersEncrypted },
      update: { status: record.status, answersEncrypted },
    });
  }

  async update(vendorId: string, changes: Prisma.VendorVerificationUncheckedUpdateInput, client: DatabaseClient): Promise<void> {
    await client.vendorVerification.update({ where: { vendorId }, data: changes });
  }

  async revealIdNumber(vendorId: string): Promise<string | null> {
    const row = await this.prisma.vendorVerification.findUnique({ where: { vendorId }, select: { idNumberEncrypted: true } });
    return row?.idNumberEncrypted ? this.encryption.decrypt(row.idNumberEncrypted, idNumberContext(vendorId)) : null;
  }

  async queue(filters: { status?: VerificationStatus; countryCode?: string | null }): Promise<QueueEntry[]> {
    const statuses = filters.status ? REVIEWABLE_STATUSES.filter((status) => status === filters.status) : REVIEWABLE_STATUSES;
    if (statuses.length === 0) {
      return [];
    }
    const rows = await this.prisma.vendorVerification.findMany({
      where: { status: { in: [...statuses] }, ...(filters.countryCode ? { countryCode: filters.countryCode } : {}) },
      include: { vendor: { select: { businessName: true } } },
      orderBy: { submittedAt: "asc" },
      take: 200,
    });
    return rows.map((row) => ({ vendorId: row.vendorId, businessName: row.vendor.businessName, countryCode: row.countryCode, status: row.status, submittedAt: row.submittedAt }));
  }

  private toRecord(row: VendorVerification): VerificationRecord {
    const answers = row.answersEncrypted ? (JSON.parse(this.encryption.decrypt(row.answersEncrypted, answersContext(row.vendorId))) as VerificationAnswers) : {};
    return {
      vendorId: row.vendorId,
      countryCode: row.countryCode,
      status: row.status,
      answers,
      idNumberLast4: row.idNumberLast4,
      provider: row.provider,
      submittedAt: row.submittedAt,
      decidedAt: row.decidedAt,
      decisionReason: row.decisionReason,
    };
  }
}
