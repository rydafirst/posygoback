import type { Permission } from "../access/permissions";

export interface AttentionItem {
  key: string;
  label: string;
  count: number;
  href: string;
  permission: Permission;
}

export interface MoneyTotal {
  currency: string;
  amountMinor: number;
}

export interface DashboardView {
  countryCode: string | null;
  attention: AttentionItem[];
  activity: { newVendors: number; ordersCreated: number; ordersShipped: number; stockReceived: number; storeSales: MoneyTotal[]; feesCharged: MoneyTotal[]; walletBalances: MoneyTotal[] } | null;
}
