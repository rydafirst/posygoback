import { Injectable } from "@nestjs/common";

import type { AuthPrincipal } from "../../common/auth/auth-principal";
import { PrismaService } from "../../database/prisma.service";
import { INBOUND_STAGE_GUIDE, Money, OPEN_INBOUND_STATUSES, OPEN_ORDER_STATUSES, ORDER_STAGE_GUIDE } from "../../shared";

const RECENT_CHARGES = 5;
const SHOWN_SHIPMENTS = 10;

function localeFor(countryCode: string): string {
  return countryCode === "US" ? "en-US" : "en-GB";
}

@Injectable()
export class AccountSummaryService {
  constructor(private readonly prisma: PrismaService) {}

  async describe(principal: AuthPrincipal | null): Promise<string> {
    if (!principal) {
      return "The person isn't signed in.";
    }
    if (!principal.vendorId) {
      return `The person is signed in as staff (${principal.role}). You have no account details for them.`;
    }
    const vendor = await this.prisma.vendor.findUniqueOrThrow({ where: { id: principal.vendorId }, include: { country: true } });
    const locale = localeFor(vendor.countryCode);
    const money = (minor: bigint) => Money.of(Number(minor), vendor.country.currency).format(locale);
    const [wallet, charges, shipments, orders, products] = await Promise.all([
      this.prisma.wallet.findUnique({ where: { vendorId_currency: { vendorId: vendor.id, currency: vendor.country.currency } } }),
      this.prisma.ledgerEntry.findMany({ where: { vendorId: vendor.id }, orderBy: { createdAt: "desc" }, take: RECENT_CHARGES }),
      this.prisma.inboundShipment.findMany({ where: { vendorId: vendor.id, status: { in: ["DRAFT", ...OPEN_INBOUND_STATUSES] } }, orderBy: { createdAt: "desc" }, take: SHOWN_SHIPMENTS }),
      this.prisma.order.groupBy({ by: ["status"], where: { vendorId: vendor.id, status: { in: [...OPEN_ORDER_STATUSES] } }, _count: { _all: true } }),
      this.prisma.product.count({ where: { vendorId: vendor.id, status: "ACTIVE" } }),
    ]);
    const lines = [
      `Business: ${vendor.businessName}, selling from ${vendor.country.name}, account status ${vendor.status}. Their role: ${principal.role}.`,
      wallet ? `Wallet balance: ${money(wallet.balanceMinor)} (wallet status ${wallet.status}, low balance alert at ${money(wallet.lowBalanceThresholdMinor)}).` : "No wallet yet.",
      `Active products: ${products}.`,
      charges.length > 0
        ? `Latest wallet entries:\n${charges.map((entry) => `- ${entry.createdAt.toISOString().slice(0, 10)} ${entry.type} ${money(entry.amountMinor)}: ${entry.description}`).join("\n")}`
        : "No wallet entries yet.",
      shipments.length > 0
        ? `Stock shipments not finished:\n${shipments.map((shipment) => `- ${shipment.reference}: ${INBOUND_STAGE_GUIDE[shipment.status].label}, expected ${shipment.expectedArrivalDate.toISOString().slice(0, 10)}${shipment.statusReason ? `, reason: ${shipment.statusReason}` : ""}`).join("\n")}`
        : "No stock shipments in progress.",
      orders.length > 0 ? `Open orders by stage:\n${orders.map((group) => `- ${ORDER_STAGE_GUIDE[group.status].label}: ${group._count._all}`).join("\n")}` : "No open orders.",
    ];
    return lines.join("\n");
  }
}
