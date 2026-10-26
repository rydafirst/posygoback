import { Injectable } from "@nestjs/common";

import { Errors } from "../../../common/http/app-exception";
import { lockRow } from "../../../database/prisma.service";
import type { Prisma } from "../../../generated/prisma/client";
import { Money, partnerProgramme, tierFor } from "../../../shared";

const PENDING_INBOUND = ["SUBMITTED", "ARRIVED", "ON_HOLD"] as const;
const NO_INBOUND = "00000000-0000-0000-0000-000000000000";

export interface IncomingItem {
  name: string;
  unitValueMinor: number;
  quantity: number;
}

@Injectable()
export class PartnerCapacityService {
  async assertCanAccept(tx: Prisma.TransactionClient, warehouseId: string, inboundId: string): Promise<void> {
    const lines = await tx.inboundLine.findMany({ where: { inboundId }, select: { declaredQuantity: true, product: { select: { name: true, declaredValueMinor: true } } } });
    const items = lines.map((line) => ({ name: line.product.name, unitValueMinor: line.product.declaredValueMinor, quantity: line.declaredQuantity }));
    await this.assertRoom(tx, warehouseId, items, { inboundId, unavailable: "That hub isn't taking deliveries right now. Edit the shipment to choose another." });
  }

  async assertCanTake(tx: Prisma.TransactionClient, warehouseId: string, items: readonly IncomingItem[]): Promise<void> {
    await this.assertRoom(tx, warehouseId, items, { inboundId: NO_INBOUND, unavailable: "That hub isn't taking stock right now. Choose another destination." });
  }

  private async assertRoom(tx: Prisma.TransactionClient, warehouseId: string, items: readonly IncomingItem[], context: { inboundId: string; unavailable: string }): Promise<void> {
    const warehouse = await tx.warehouse.findUniqueOrThrow({ where: { id: warehouseId }, select: { partnerId: true, country: { select: { config: true, currency: true } } } });
    if (!warehouse.partnerId) {
      return;
    }
    await lockRow(tx, "fulfilmentPartners", warehouse.partnerId);
    const partner = await tx.fulfilmentPartner.findUniqueOrThrow({ where: { id: warehouse.partnerId }, select: { status: true, tierLevel: true } });
    if (partner.status !== "ACTIVE") {
      throw Errors.invalidTransition(context.unavailable);
    }
    const tier = tierFor(partnerProgramme(warehouse.country.config as { partners?: unknown }), partner.tierLevel);
    const money = (amount: number) => Money.of(amount, warehouse.country.currency).format("en-GB");
    const tooValuable = [...new Set(items.filter((item) => item.unitValueMinor > tier.maxItemValueMinor).map((item) => item.name))];
    if (tooValuable.length > 0) {
      throw Errors.invalidTransition(`This hub takes items worth up to ${money(tier.maxItemValueMinor)} each for now. Send these to another hub: ${tooValuable.join(", ")}.`);
    }
    const incoming = items.reduce((total, item) => total + item.quantity * item.unitValueMinor, 0);
    const committed = await this.committedValue(tx, warehouse.partnerId, context.inboundId);
    if (committed + incoming > tier.maxStockValueMinor) {
      throw Errors.invalidTransition(`This hub can hold stock worth ${money(Math.max(0, tier.maxStockValueMinor - committed))} more right now. Send fewer units or choose another hub.`);
    }
  }

  private async committedValue(tx: Prisma.TransactionClient, partnerId: string, excludeInboundId: string): Promise<number> {
    const [held] = await tx.$queryRaw<Array<{ value: bigint }>>`
      SELECT COALESCE(SUM((lot.quantity_available + lot.quantity_reserved)::bigint * product.declared_value_minor), 0)::bigint AS value
      FROM stock_lots lot
      JOIN warehouses warehouse ON warehouse.id = lot.warehouse_id
      JOIN products product ON product.id = lot.product_id
      WHERE warehouse.partner_id = ${partnerId}::uuid`;
    const [pending] = await tx.$queryRaw<Array<{ value: bigint }>>`
      SELECT COALESCE(SUM(line.declared_quantity::bigint * product.declared_value_minor), 0)::bigint AS value
      FROM inbound_lines line
      JOIN inbound_shipments inbound ON inbound.id = line.inbound_id
      JOIN warehouses warehouse ON warehouse.id = inbound.warehouse_id
      JOIN products product ON product.id = line.product_id
      WHERE warehouse.partner_id = ${partnerId}::uuid AND inbound.id <> ${excludeInboundId}::uuid AND inbound.status::text = ANY(${[...PENDING_INBOUND]})`;
    const [moving] = await tx.$queryRaw<Array<{ value: bigint }>>`
      SELECT COALESCE(SUM(line.quantity_sent::bigint * product.declared_value_minor), 0)::bigint AS value
      FROM stock_transfer_lines line
      JOIN stock_transfers transfer ON transfer.id = line.transfer_id
      JOIN warehouses warehouse ON warehouse.id = transfer.to_warehouse_id
      JOIN stock_lots lot ON lot.id = line.lot_id
      JOIN products product ON product.id = lot.product_id
      WHERE warehouse.partner_id = ${partnerId}::uuid AND transfer.status IN ('REQUESTED', 'DISPATCHED')`;
    return Number(held?.value ?? 0n) + Number(pending?.value ?? 0n) + Number(moving?.value ?? 0n);
  }
}
