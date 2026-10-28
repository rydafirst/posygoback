import { Injectable } from "@nestjs/common";

import type { AuthPrincipal, RequestMeta } from "../../../common/auth/auth-principal";
import type { SellerCountry } from "../../../common/auth/selected-country";
import { PrismaService } from "../../../database/prisma.service";
import type { LedgerEntry, Prisma } from "../../../generated/prisma/client";
import { AuditService } from "../../../infrastructure/audit/audit.service";
import type { LedgerEntryView, WalletView } from "../../../shared";
import { WalletLedgerService } from "./wallet-ledger.service";

export const WALLET_INCLUDE = {
  vendor: { select: { businessName: true, countryCode: true, countries: { select: { countryCode: true, country: { select: { currency: true } } } } } },
} satisfies Prisma.WalletInclude;

export type WalletWithVendor = Prisma.WalletGetPayload<{ include: typeof WALLET_INCLUDE }>;

export function toWalletView(wallet: WalletWithVendor): WalletView {
  return {
    id: wallet.id,
    vendorId: wallet.vendorId,
    businessName: wallet.vendor.businessName,
    countryCode: walletCountryCode(wallet),
    currency: wallet.currency,
    balanceMinor: Number(wallet.balanceMinor),
    lowBalanceThresholdMinor: Number(wallet.lowBalanceThresholdMinor),
    status: wallet.status,
  };
}

export function walletCountryCode(wallet: WalletWithVendor): string {
  if (wallet.vendor.countries.some((entry) => entry.countryCode === wallet.vendor.countryCode && entry.country.currency === wallet.currency)) {
    return wallet.vendor.countryCode;
  }
  return wallet.vendor.countries.find((entry) => entry.country.currency === wallet.currency)?.countryCode ?? wallet.vendor.countryCode;
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

  async mine(country: SellerCountry): Promise<WalletView> {
    return { ...toWalletView(await this.vendorWallet(country)), countryCode: country.countryCode };
  }

  async myLedger(country: SellerCountry): Promise<LedgerEntryView[]> {
    const wallet = await this.vendorWallet(country);
    return this.entries(wallet.id);
  }

  async updateSettings(principal: AuthPrincipal, country: SellerCountry, lowBalanceThresholdMinor: number, meta: RequestMeta): Promise<WalletView> {
    const wallet = await this.vendorWallet(country);
    const updated = await this.prisma.$transaction(async (tx) => {
      const row = await tx.wallet.update({ where: { id: wallet.id }, data: { lowBalanceThresholdMinor: BigInt(lowBalanceThresholdMinor) }, include: WALLET_INCLUDE });
      await this.audit.record(
        {
          actor: { userId: principal.userId, role: principal.role },
          action: "wallet.settings_updated",
          resourceType: "wallet",
          resourceId: wallet.id,
          vendorId: wallet.vendorId,
          countryCode: country.countryCode,
          before: { lowBalanceThresholdMinor: Number(wallet.lowBalanceThresholdMinor) },
          after: { lowBalanceThresholdMinor },
          meta,
        },
        tx,
      );
      return row;
    });
    return { ...toWalletView(updated), countryCode: country.countryCode };
  }

  async entries(walletId: string): Promise<LedgerEntryView[]> {
    const rows = await this.prisma.ledgerEntry.findMany({ where: { walletId }, orderBy: { createdAt: "desc" }, take: 200 });
    return rows.map(toLedgerView);
  }

  private async vendorWallet(country: SellerCountry): Promise<WalletWithVendor> {
    const wallet = await this.ledger.walletFor(this.prisma, country.vendorId, country.currency);
    return this.prisma.wallet.findUniqueOrThrow({ where: { id: wallet.id }, include: WALLET_INCLUDE });
  }
}
