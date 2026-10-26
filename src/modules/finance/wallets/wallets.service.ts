import { Injectable } from "@nestjs/common";

import type { AuthPrincipal, RequestMeta } from "../../../common/auth/auth-principal";
import { Errors } from "../../../common/http/app-exception";
import { PrismaService } from "../../../database/prisma.service";
import type { LedgerEntry, Prisma } from "../../../generated/prisma/client";
import { AuditService } from "../../../infrastructure/audit/audit.service";
import type { LedgerEntryView, WalletView } from "../../../shared";
import { vendorIdOf } from "../../onboarding/scope";
import { WalletLedgerService } from "./wallet-ledger.service";

const WALLET_INCLUDE = { vendor: { select: { businessName: true, countryCode: true } } } satisfies Prisma.WalletInclude;

export type WalletWithVendor = Prisma.WalletGetPayload<{ include: typeof WALLET_INCLUDE }>;

export function toWalletView(wallet: WalletWithVendor): WalletView {
  return {
    id: wallet.id,
    vendorId: wallet.vendorId,
    businessName: wallet.vendor.businessName,
    countryCode: wallet.vendor.countryCode,
    currency: wallet.currency,
    balanceMinor: Number(wallet.balanceMinor),
    lowBalanceThresholdMinor: Number(wallet.lowBalanceThresholdMinor),
    status: wallet.status,
  };
}

export function toLedgerView(entry: LedgerEntry): LedgerEntryView {
  return {
    id: entry.id,
    type: entry.type,
    amountMinor: Number(entry.amountMinor),
    balanceAfterMinor: Number(entry.balanceAfterMinor),
    description: entry.description,
    createdAt: entry.createdAt.toISOString(),
  };
}

@Injectable()
export class WalletsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly ledger: WalletLedgerService,
    private readonly audit: AuditService,
  ) {}

  async mine(principal: AuthPrincipal): Promise<WalletView> {
    return toWalletView(await this.vendorWallet(principal));
  }

  async myLedger(principal: AuthPrincipal): Promise<LedgerEntryView[]> {
    const wallet = await this.vendorWallet(principal);
    return this.entries(wallet.id);
  }

  async updateSettings(principal: AuthPrincipal, lowBalanceThresholdMinor: number, meta: RequestMeta): Promise<WalletView> {
    const wallet = await this.vendorWallet(principal);
    const updated = await this.prisma.$transaction(async (tx) => {
      const row = await tx.wallet.update({ where: { id: wallet.id }, data: { lowBalanceThresholdMinor: BigInt(lowBalanceThresholdMinor) }, include: WALLET_INCLUDE });
      await this.audit.record(
        {
          actor: { userId: principal.userId, role: principal.role },
          action: "wallet.settings_updated",
          resourceType: "wallet",
          resourceId: wallet.id,
          vendorId: wallet.vendorId,
          before: { lowBalanceThresholdMinor: Number(wallet.lowBalanceThresholdMinor) },
          after: { lowBalanceThresholdMinor },
          meta,
        },
        tx,
      );
      return row;
    });
    return toWalletView(updated);
  }

  async entries(walletId: string): Promise<LedgerEntryView[]> {
    const rows = await this.prisma.ledgerEntry.findMany({ where: { walletId }, orderBy: { createdAt: "desc" }, take: 200 });
    return rows.map(toLedgerView);
  }

  private async vendorWallet(principal: AuthPrincipal): Promise<WalletWithVendor> {
    const vendorId = vendorIdOf(principal);
    const vendor = await this.prisma.vendor.findUnique({ where: { id: vendorId }, include: { country: { select: { currency: true } } } });
    if (!vendor) {
      throw Errors.notFound();
    }
    const wallet = await this.ledger.walletFor(this.prisma, vendorId, vendor.country.currency);
    return this.prisma.wallet.findUniqueOrThrow({ where: { id: wallet.id }, include: WALLET_INCLUDE });
  }
}
