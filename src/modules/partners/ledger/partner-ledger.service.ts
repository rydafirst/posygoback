import { Injectable } from "@nestjs/common";

import { type DatabaseClient, lockRow } from "../../../database/prisma.service";
import type { PartnerLedgerEntry, Prisma } from "../../../generated/prisma/client";
import type { PartnerEntryType } from "../../../shared";

export interface PartnerPosting {
  type: PartnerEntryType;
  bucket: "AVAILABLE" | "HELD";
  amountMinor: number;
  description: string;
  idempotencyKey: string;
  reference?: { type: string; id: string };
  releaseOn?: Date;
  actorId?: string | null;
}

export interface PartnerBalances {
  availableMinor: number;
  heldMinor: number;
}

@Injectable()
export class PartnerLedgerService {
  async post(tx: Prisma.TransactionClient, partnerId: string, posting: PartnerPosting): Promise<{ entry: PartnerLedgerEntry; duplicate: boolean }> {
    if (!Number.isSafeInteger(posting.amountMinor) || posting.amountMinor === 0) {
      throw new RangeError("Partner postings take a non-zero whole amount in minor units");
    }
    await lockRow(tx, "fulfilmentPartners", partnerId);
    const existing = await tx.partnerLedgerEntry.findUnique({ where: { partnerId_idempotencyKey: { partnerId, idempotencyKey: posting.idempotencyKey } } });
    if (existing) {
      return { entry: existing, duplicate: true };
    }
    const partner = await tx.fulfilmentPartner.findUniqueOrThrow({ where: { id: partnerId }, select: { country: { select: { currency: true } } } });
    const entry = await tx.partnerLedgerEntry.create({
      data: {
        partnerId,
        currency: partner.country.currency,
        type: posting.type,
        bucket: posting.bucket,
        amountMinor: BigInt(posting.amountMinor),
        description: posting.description.slice(0, 300),
        idempotencyKey: posting.idempotencyKey,
        referenceType: posting.reference?.type ?? null,
        referenceId: posting.reference?.id ?? null,
        releaseOn: posting.releaseOn ?? null,
        createdBy: posting.actorId ?? null,
      },
    });
    return { entry, duplicate: false };
  }

  async balances(client: DatabaseClient, partnerId: string): Promise<PartnerBalances> {
    const sums = await client.partnerLedgerEntry.groupBy({ by: ["bucket"], where: { partnerId }, _sum: { amountMinor: true } });
    const total = (bucket: "AVAILABLE" | "HELD") => Number(sums.find((row) => row.bucket === bucket)?._sum.amountMinor ?? 0n);
    return { availableMinor: total("AVAILABLE"), heldMinor: total("HELD") };
  }
}
