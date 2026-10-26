import { Injectable } from "@nestjs/common";

import { Errors } from "../../../common/http/app-exception";
import { lockRow } from "../../../database/prisma.service";
import type { CustodyClaim, Prisma } from "../../../generated/prisma/client";
import { WalletLedgerService } from "../../finance/wallets/wallet-ledger.service";
import { InventoryLedgerService } from "../../stock/inventory/inventory-ledger.service";
import { PartnerLedgerService } from "../ledger/partner-ledger.service";

export interface Settlement {
  recoveredLedgerMinor: number;
  recoveredDepositMinor: number;
  platformCoverMinor: number;
}

const NOTHING: Settlement = { recoveredLedgerMinor: 0, recoveredDepositMinor: 0, platformCoverMinor: 0 };

@Injectable()
export class ClaimSettlementService {
  constructor(
    private readonly wallets: WalletLedgerService,
    private readonly partnerLedger: PartnerLedgerService,
    private readonly inventory: InventoryLedgerService,
  ) {}

  async settle(tx: Prisma.TransactionClient, claim: CustodyClaim, actorId: string): Promise<Settlement> {
    if (claim.writeOff) {
      await this.writeOff(tx, claim, actorId);
    }
    const compensation = Number(claim.compensationMinor);
    if (claim.liability === "VENDOR" || compensation === 0) {
      return NOTHING;
    }
    const wallet = await this.wallets.walletFor(tx, claim.vendorId, claim.currency);
    await this.wallets.post(tx, wallet.id, {
      type: "COMPENSATION",
      amountMinor: compensation,
      description: `Compensation for claim ${claim.reference}`,
      idempotencyKey: `claim:${claim.id}`,
      reference: { type: "custody_claim", id: claim.id },
      actorId,
    });
    if (claim.liability !== "PARTNER" || !claim.partnerId) {
      return { ...NOTHING, platformCoverMinor: compensation };
    }
    return this.recover(tx, claim, claim.partnerId, compensation, actorId);
  }

  private async writeOff(tx: Prisma.TransactionClient, claim: CustodyClaim, actorId: string): Promise<void> {
    if (!claim.lotId) {
      return;
    }
    await lockRow(tx, "stockLots", claim.lotId);
    const lot = await tx.stockLot.findUniqueOrThrow({ where: { id: claim.lotId }, select: { id: true, vendorId: true, warehouseId: true, quantityAvailable: true, locationId: true } });
    if (lot.quantityAvailable < claim.quantity) {
      throw Errors.invalidTransition(`Only ${lot.quantityAvailable} units of that stock are free to write off. Release any orders holding it first.`);
    }
    await tx.stockLot.update({ where: { id: lot.id }, data: { quantityAvailable: { decrement: claim.quantity } } });
    await this.inventory.record(
      tx,
      lot,
      actorId,
      { type: "WRITE_OFF", deltaAvailable: -claim.quantity, reason: `Claim ${claim.reference}`, reference: { type: "custody_claim", id: claim.id } },
      { type: "WRITTEN_OFF", quantity: claim.quantity, fromLocationId: lot.locationId },
    );
  }

  private async recover(tx: Prisma.TransactionClient, claim: CustodyClaim, partnerId: string, compensation: number, actorId: string): Promise<Settlement> {
    await lockRow(tx, "fulfilmentPartners", partnerId);
    const partner = await tx.fulfilmentPartner.findUniqueOrThrow({ where: { id: partnerId }, select: { country: { select: { currency: true } } } });
    if (partner.country.currency !== claim.currency) {
      return { ...NOTHING, platformCoverMinor: compensation };
    }
    const { availableMinor } = await this.partnerLedger.balances(tx, partnerId);
    const fromLedger = Math.max(0, Math.min(availableMinor, compensation));
    if (fromLedger > 0) {
      await this.partnerLedger.post(tx, partnerId, {
        type: "ADJUSTMENT",
        bucket: "AVAILABLE",
        amountMinor: -fromLedger,
        description: `Recovered for claim ${claim.reference}`,
        idempotencyKey: `claim:${claim.id}`,
        reference: { type: "custody_claim", id: claim.id },
        actorId,
      });
    }
    let remaining = compensation - fromLedger;
    let fromDeposit = 0;
    const securities = await tx.partnerSecurity.findMany({
      where: { partnerId, currency: claim.currency, confirmedAt: { not: null }, releasedAt: null, OR: [{ expiresOn: null }, { expiresOn: { gt: new Date() } }] },
      include: { draws: { select: { amountMinor: true } } },
      orderBy: { receivedAt: "asc" },
    });
    for (const security of securities) {
      if (remaining === 0) {
        break;
      }
      const free = Number(security.amountMinor) - security.draws.reduce((total, draw) => total + Number(draw.amountMinor), 0);
      const take = Math.min(free, remaining);
      if (take > 0) {
        await tx.partnerSecurityDraw.create({ data: { securityId: security.id, claimId: claim.id, amountMinor: BigInt(take), createdBy: actorId } });
        remaining -= take;
        fromDeposit += take;
      }
    }
    return { recoveredLedgerMinor: fromLedger, recoveredDepositMinor: fromDeposit, platformCoverMinor: remaining };
  }
}
