import { Injectable } from "@nestjs/common";

import type { AuthPrincipal } from "../../../common/auth/auth-principal";
import { PrismaService } from "../../../database/prisma.service";
import { INBOUND_STAGE_GUIDE, Money, OPEN_INBOUND_STATUSES, OPEN_ORDER_STATUSES, ORDER_STAGE_GUIDE } from "../../../shared";

const RECENT_CHARGES = 5;
const SHOWN_SHIPMENTS = 10;

function localeFor(countryCode: string): string {
  return countryCode === "US" ? "en-US" : "en-GB";
}

@Injectable()
export class VendorContextService {
  constructor(private readonly prisma: PrismaService) {}

  async describe(principal: AuthPrincipal & { vendorId: string }): Promise<string> {
    const vendor = await this.prisma.vendor.findUniqueOrThrow({
      where: { id: principal.vendorId },
      include: { country: true, countries: { include: { country: { select: { name: true } } }, orderBy: { createdAt: "asc" } } },
    });
    const locale = localeFor(vendor.countryCode);
    const money = (minor: bigint, currency: string) => Money.of(Number(minor), currency).format(locale);
    const [wallets, charges, shipments, orders, products] = await Promise.all([
      this.prisma.wallet.findMany({ where: { vendorId: vendor.id }, orderBy: { currency: "asc" } }),
      this.prisma.ledgerEntry.findMany({ where: { vendorId: vendor.id }, include: { wallet: { select: { currency: true } } }, orderBy: { createdAt: "desc" }, take: RECENT_CHARGES }),
      this.prisma.inboundShipment.findMany({ where: { vendorId: vendor.id, status: { in: ["DRAFT", ...OPEN_INBOUND_STATUSES] } }, orderBy: { createdAt: "desc" }, take: SHOWN_SHIPMENTS }),
      this.prisma.order.groupBy({ by: ["status"], where: { vendorId: vendor.id, status: { in: [...OPEN_ORDER_STATUSES] } }, _count: { _all: true } }),
      this.prisma.product.count({ where: { vendorId: vendor.id, status: "ACTIVE" } }),
    ]);
    const countries = vendor.countries.map((entry) => entry.country.name).join(", ") || vendor.country.name;
    const lines = [
      `Business: ${vendor.businessName}, account country ${vendor.country.name}, stores stock in ${countries}, account status ${vendor.status}. Their role: ${principal.role}.`,
      wallets.length > 0
        ? `Wallets, one per currency:\n${wallets.map((wallet) => `- ${money(wallet.balanceMinor, wallet.currency)} (status ${wallet.status}, low balance alert at ${money(wallet.lowBalanceThresholdMinor, wallet.currency)})`).join("\n")}`
        : "No wallet yet.",
      `Active products: ${products}.`,
      charges.length > 0
        ? `Latest wallet entries:\n${charges.map((entry) => `- ${entry.createdAt.toISOString().slice(0, 10)} ${entry.type} ${money(entry.amountMinor, entry.wallet.currency)}: ${entry.description}`).join("\n")}`
        : "No wallet entries yet.",
      shipments.length > 0
        ? `Stock shipments not finished:\n${shipments.map((shipment) => `- ${shipment.reference} (${shipment.countryCode}): ${INBOUND_STAGE_GUIDE[shipment.status].label}, expected ${shipment.expectedArrivalDate.toISOString().slice(0, 10)}${shipment.statusReason ? `, reason: ${shipment.statusReason}` : ""}`).join("\n")}`
        : "No stock shipments in progress.",
      orders.length > 0 ? `Open orders by stage:\n${orders.map((group) => `- ${ORDER_STAGE_GUIDE[group.status].label}: ${group._count._all}`).join("\n")}` : "No open orders.",
    ];
    return [`Who you're helping: a seller. Call them by their business name, ${vendor.businessName}.`, ...lines].join("\n");
  }
}
