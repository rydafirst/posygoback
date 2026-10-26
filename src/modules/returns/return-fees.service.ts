import { Injectable } from "@nestjs/common";

import type { Prisma, VendorReturn } from "../../generated/prisma/client";
import { WalletLedgerService } from "../finance/wallets/wallet-ledger.service";

type Chargeable = Pick<VendorReturn, "id" | "reference" | "vendorId" | "currency" | "feeMinor">;

@Injectable()
export class ReturnFeesService {
  constructor(private readonly ledger: WalletLedgerService) {}

  async charge(tx: Prisma.TransactionClient, entry: Chargeable, actorId: string | null): Promise<void> {
    if (entry.feeMinor <= 0n) {
      return;
    }
    const wallet = await this.ledger.walletFor(tx, entry.vendorId, entry.currency);
    await this.ledger.post(tx, wallet.id, {
      type: "RETURN",
      amountMinor: Number(entry.feeMinor),
      description: `Handling for return ${entry.reference}`,
      idempotencyKey: `return-fee:${entry.id}`,
      reference: { type: "vendor_return", id: entry.id },
      actorId,
    });
  }

  async giveBack(tx: Prisma.TransactionClient, entry: Chargeable, why: "cancelled" | "expired"): Promise<void> {
    if (entry.feeMinor <= 0n) {
      return;
    }
    const wallet = await this.ledger.walletFor(tx, entry.vendorId, entry.currency);
    await this.ledger.post(tx, wallet.id, {
      type: "REVERSAL",
      amountMinor: Number(entry.feeMinor),
      description: `Handling fee back: return ${entry.reference} ${why}`,
      idempotencyKey: `return-fee-back:${entry.id}`,
      reference: { type: "vendor_return", id: entry.id },
    });
  }
}
