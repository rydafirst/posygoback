import { Inject, Injectable, type OnModuleDestroy } from "@nestjs/common";
import { PrismaPg } from "@prisma/adapter-pg";

import { APP_CONFIG } from "../config/config.module";
import type { AppConfig } from "../config/config.schema";
import { Prisma, PrismaClient } from "../generated/prisma/client";

export type DatabaseClient = PrismaService | Prisma.TransactionClient;

export function createAdapter(config: Pick<AppConfig, "DATABASE_URL" | "DB_POOL_MAX" | "DB_STATEMENT_TIMEOUT_MS">): PrismaPg {
  return new PrismaPg({
    connectionString: config.DATABASE_URL,
    max: config.DB_POOL_MAX,
    statement_timeout: config.DB_STATEMENT_TIMEOUT_MS,
    idle_in_transaction_session_timeout: config.DB_STATEMENT_TIMEOUT_MS * 2,
    connectionTimeoutMillis: 10_000,
  });
}

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleDestroy {
  constructor(@Inject(APP_CONFIG) config: AppConfig) {
    super({ adapter: createAdapter(config), transactionOptions: { maxWait: 5_000, timeout: 15_000 } });
  }

  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
  }
}

const LOCKABLE_TABLES = {
  vendors: "vendors",
  vendorVerifications: "vendor_verifications",
  vendorInvitations: "vendor_invitations",
  staffInvitations: "staff_invitations",
  inboundShipments: "inbound_shipments",
  inventoryLocations: "inventory_locations",
  products: "products",
  stockLots: "stock_lots",
  sessions: "sessions",
  wallets: "wallets",
  feeSchedules: "fee_schedules",
  walletAdjustments: "wallet_adjustments",
  topUps: "top_ups",
  orders: "orders",
  apiKeys: "api_keys",
  fulfilmentPartners: "fulfilment_partners",
  partnerPayouts: "partner_payouts",
  custodyClaims: "custody_claims",
  stockTransfers: "stock_transfers",
  stockCounts: "stock_counts",
  storefrontOrders: "storefront_orders",
  vendorReturns: "vendor_returns",
  shoppingRequests: "shopping_requests",
  vendorActivationPayments: "vendor_activation_payments",
} as const;

export type LockableTable = keyof typeof LOCKABLE_TABLES;

export async function lockRow(tx: Prisma.TransactionClient, table: LockableTable, id: string): Promise<boolean> {
  const column = table === "vendorVerifications" ? "vendor_id" : "id";
  const rows = await tx.$queryRaw<unknown[]>`SELECT 1 FROM ${Prisma.raw(`"${LOCKABLE_TABLES[table]}"`)} WHERE ${Prisma.raw(`"${column}"`)} = ${id}::uuid FOR UPDATE`;
  return rows.length > 0;
}

export function isUniqueViolation(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002";
}

export function jsonOrNull(value: unknown): Prisma.InputJsonValue | typeof Prisma.DbNull {
  return value === undefined || value === null ? Prisma.DbNull : value;
}
