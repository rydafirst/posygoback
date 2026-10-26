import { Injectable } from "@nestjs/common";

import { Errors } from "../../../common/http/app-exception";
import { type DatabaseClient, lockRow } from "../../../database/prisma.service";
import type { LedgerEntry, Prisma, Wallet } from "../../../generated/prisma/client";
import { CREDIT_TYPES, type LedgerEntryType, Money } from "../../../shared";

export interface Posting {
  type: LedgerEntryType;
  amountMinor: number;
  description: string;
  idempotencyKey: string;
  reference?: { type: string; id: string };
  actorId?: string | null;
}

const ALLOWED_WHILE_FROZEN: readonly LedgerEntryType[] = ["PAYMENT_REVERSAL"];

export interface PostingResult {
  entry: LedgerEntry;
  wallet: Wallet;
  balanceBeforeMinor: number;
  duplicate: boolean;
}

@Injectable()
export class WalletLedgerService {
  async walletFor(client: DatabaseClient, vendorId: string, currency: string): Promise<Wallet> {
    return client.wallet.upsert({ where: { vendorId_currency: { vendorId, currency } }, create: { vendorId, currency }, update: {} });
  }

  async post(tx: Prisma.TransactionClient, walletId: string, posting: Posting): Promise<PostingResult> {
    if (!Number.isSafeInteger(posting.amountMinor) || posting.amountMinor <= 0) {
      throw new RangeError("Postings take a positive whole amount in minor units");
    }
    await lockRow(tx, "wallets", walletId);
    const wallet = await tx.wallet.findUniqueOrThrow({ where: { id: walletId } });
    const existing = await tx.ledgerEntry.findUnique({ where: { walletId_idempotencyKey: { walletId, idempotencyKey: posting.idempotencyKey } } });
    const balanceBeforeMinor = Number(wallet.balanceMinor);
    if (existing) {
      return { entry: existing, wallet, balanceBeforeMinor, duplicate: true };
    }
    const credit = CREDIT_TYPES.includes(posting.type);
    if (wallet.status === "CLOSED" || (!credit && wallet.status === "FROZEN" && !ALLOWED_WHILE_FROZEN.includes(posting.type))) {
      throw Errors.walletUnavailable();
    }
    const balanceAfterMinor = balanceBeforeMinor + (credit ? posting.amountMinor : -posting.amountMinor);
    if (balanceAfterMinor < 0) {
      throw Errors.insufficientFunds(Money.of(-balanceAfterMinor, wallet.currency).format("en-GB"));
    }
    const entry = await tx.ledgerEntry.create({
      data: {
        walletId,
        vendorId: wallet.vendorId,
        type: posting.type,
        amountMinor: BigInt(credit ? posting.amountMinor : -posting.amountMinor),
        balanceAfterMinor: BigInt(balanceAfterMinor),
        description: posting.description,
        referenceType: posting.reference?.type ?? null,
        referenceId: posting.reference?.id ?? null,
        idempotencyKey: posting.idempotencyKey,
        createdBy: posting.actorId ?? null,
      },
    });
    const updated = await tx.wallet.findUniqueOrThrow({ where: { id: walletId } });
    return { entry, wallet: updated, balanceBeforeMinor, duplicate: false };
  }
}
