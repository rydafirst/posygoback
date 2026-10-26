import { Injectable } from "@nestjs/common";

import type { AuthPrincipal, RequestMeta } from "../../../common/auth/auth-principal";
import { Errors } from "../../../common/http/app-exception";
import { lockRow, PrismaService } from "../../../database/prisma.service";
import type { InboundLine, InboundShipment, Prisma } from "../../../generated/prisma/client";
import { AuditService } from "../../../infrastructure/audit/audit.service";
import { type BoxCounts, canApplyInboundAction, type ReceiveInboundInput, STORAGE_TIERS, totalBoxes } from "../../../shared";
import { FilesService } from "../../files/files.service";
import { PartnerEarningsService } from "../../partners/ledger/partner-earnings.service";
import { PartnerCapacityService } from "../../partners/operations/partner-capacity.service";
import { addDays, BILLING_CYCLE_DAYS, startOfUtcDay } from "../../finance/jobs/storage-billing.service";
import { InventoryLedgerService } from "../inventory/inventory-ledger.service";
import { WarehouseAccessService } from "../warehouses/warehouse-access.service";
import type { InboundRow } from "./inbound.repository";
import { lotCode } from "./references";

type CountedLine = ReceiveInboundInput["lines"][number];

export interface ReceivingOutcome {
  inbound: InboundRow;
  matched: boolean;
}

function boxCountsMatch(declared: BoxCounts, received: BoxCounts): boolean {
  return STORAGE_TIERS.every((tier) => (declared[tier] ?? 0) === (received[tier] ?? 0));
}

function moreThanDeclared(declared: BoxCounts, received: BoxCounts): boolean {
  return STORAGE_TIERS.some((tier) => (received[tier] ?? 0) > (declared[tier] ?? 0));
}

@Injectable()
export class ReceivingService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly warehouses: WarehouseAccessService,
    private readonly files: FilesService,
    private readonly ledger: InventoryLedgerService,
    private readonly earnings: PartnerEarningsService,
    private readonly capacity: PartnerCapacityService,
    private readonly audit: AuditService,
  ) {}

  async receive(principal: AuthPrincipal, inboundId: string, input: ReceiveInboundInput, meta: RequestMeta): Promise<ReceivingOutcome> {
    if (totalBoxes(input.boxCounts) === 0) {
      throw Errors.validation({ boxCounts: ["Count at least one box"] });
    }
    await this.assertEvidence(principal, input);
    return this.prisma.$transaction(async (tx) => {
      const inbound = (await lockRow(tx, "inboundShipments", inboundId)) ? await tx.inboundShipment.findUnique({ where: { id: inboundId } }) : null;
      if (!inbound) {
        throw Errors.notFound();
      }
      await this.warehouses.inScope(principal, inbound.warehouseId, tx);
      if (!canApplyInboundAction("COMPLETE", inbound.status)) {
        throw Errors.invalidTransition("Check the shipment in before receiving it.");
      }
      const lines = await tx.inboundLine.findMany({ where: { inboundId: inbound.id } });
      const counted = this.matchLines(lines, input.lines);
      const receivedAt = new Date();
      await tx.inboundPhoto.createMany({ data: input.photoFileIds.map((fileId) => ({ fileId, inboundId: inbound.id })) });
      if (principal.partnerId) {
        await this.assertWithinDeclared(tx, inbound, lines, counted, input.boxCounts);
      }
      let matched = boxCountsMatch(inbound.declaredBoxCounts as BoxCounts, input.boxCounts);
      for (const line of lines) {
        const tally = counted.get(line.id)!;
        await tx.inboundPhoto.createMany({ data: tally.damagePhotoFileIds.map((fileId) => ({ fileId, inboundId: inbound.id, lineId: line.id })) });
        await tx.inboundLine.update({ where: { id: line.id }, data: { acceptedQuantity: tally.acceptedQuantity, damagedQuantity: tally.damagedQuantity, note: tally.note ?? null } });
        matched &&= tally.damagedQuantity === 0 && tally.acceptedQuantity === line.declaredQuantity;
        await this.createLots(tx, principal, inbound, line, tally, receivedAt, input.photoFileIds);
      }
      await this.createBoxes(tx, inbound, input.boxCounts, receivedAt);
      const status = matched ? "RECEIVED" : "DISCREPANCY";
      const updated = await tx.inboundShipment.update({
        where: { id: inbound.id },
        data: { status, receivedAt, receivedBy: principal.userId, receivedBoxCounts: input.boxCounts, receivingNote: input.note ?? null },
      });
      await this.earnings.inboundReceived(tx, updated, input.boxCounts);
      await this.audit.record(
        {
          actor: { userId: principal.userId, role: principal.role },
          action: `inbound.${status.toLowerCase()}`,
          resourceType: "inbound_shipment",
          resourceId: inbound.id,
          vendorId: inbound.vendorId,
          countryCode: inbound.countryCode,
          before: { status: inbound.status },
          after: { status, boxes: input.boxCounts, lines: input.lines.map(({ lineId, acceptedQuantity, damagedQuantity }) => ({ lineId, acceptedQuantity, damagedQuantity })) },
          meta,
        },
        tx,
      );
      return { inbound: updated, matched };
    });
  }

  private async assertWithinDeclared(tx: Prisma.TransactionClient, inbound: InboundShipment, lines: InboundLine[], counted: Map<string, CountedLine>, boxCounts: BoxCounts): Promise<void> {
    if (moreThanDeclared(inbound.declaredBoxCounts as BoxCounts, boxCounts)) {
      throw Errors.validation({ boxCounts: ["You counted more boxes than the vendor declared. Ask our operations team to receive this shipment."] });
    }
    if (lines.some((line) => counted.get(line.id)!.acceptedQuantity + counted.get(line.id)!.damagedQuantity > line.declaredQuantity)) {
      throw Errors.validation({ lines: ["You counted more units than the vendor declared. Ask our operations team to receive this shipment."] });
    }
    try {
      await this.capacity.assertCanAccept(tx, inbound.warehouseId, inbound.id);
    } catch {
      throw Errors.invalidTransition("This shipment would take your hub over its stock limit. Ask our operations team to receive it.");
    }
  }

  private matchLines(lines: InboundLine[], input: readonly CountedLine[]): Map<string, CountedLine> {
    const counted = new Map(input.map((line) => [line.lineId, line]));
    if (counted.size !== lines.length || lines.some((line) => !counted.has(line.id))) {
      throw Errors.validation({ lines: ["Count every line on the shipment"] });
    }
    return counted;
  }

  private async assertEvidence(principal: AuthPrincipal, input: ReceiveInboundInput): Promise<void> {
    const ids = [...input.photoFileIds, ...input.lines.flatMap((line) => line.damagePhotoFileIds)];
    if (new Set(ids).size !== ids.length) {
      throw Errors.validation({ photoFileIds: ["Each photo can only be used once"] });
    }
    const statuses = await this.files.uploadedBy(principal.userId, ids, "EVIDENCE_PHOTO");
    if (ids.some((id) => statuses.get(id) !== "VERIFIED")) {
      throw Errors.validation({ photoFileIds: ["Some photos are missing or still uploading. Add them again."] });
    }
  }

  private async createLots(
    tx: Prisma.TransactionClient,
    principal: AuthPrincipal,
    inbound: InboundRow,
    line: InboundLine,
    tally: CountedLine,
    receivedAt: Date,
    shipmentPhotos: readonly string[],
  ): Promise<void> {
    const batches = [
      { condition: "SELLABLE" as const, quantity: tally.acceptedQuantity, evidence: shipmentPhotos },
      { condition: "DAMAGED" as const, quantity: tally.damagedQuantity, evidence: tally.damagePhotoFileIds },
    ].filter((batch) => batch.quantity > 0);
    if (batches.length === 0) {
      return;
    }
    await lockRow(tx, "products", line.productId);
    const product = await tx.product.findUniqueOrThrow({ where: { id: line.productId } });
    let sequence = await tx.stockLot.count({ where: { productId: product.id } });
    for (const batch of batches) {
      sequence += 1;
      const lot = await tx.stockLot.create({
        data: {
          code: lotCode(inbound.countryCode, inbound.vendorId, product.code, sequence),
          vendorId: inbound.vendorId,
          productId: product.id,
          warehouseId: inbound.warehouseId,
          inboundId: inbound.id,
          condition: batch.condition,
          storageTier: product.storageTier,
          quantityAvailable: batch.quantity,
          receivedAt,
        },
      });
      await this.ledger.record(
        tx,
        lot,
        principal.userId,
        { type: "RECEIVE", deltaAvailable: batch.quantity, reason: batch.condition === "DAMAGED" ? "Damaged on arrival" : undefined, reference: { type: "inbound_shipment", id: inbound.id } },
        { type: "RECEIVED", quantity: batch.quantity, evidenceFileIds: batch.evidence },
      );
    }
  }

  private async createBoxes(tx: Prisma.TransactionClient, inbound: InboundRow, counts: BoxCounts, receivedAt: Date): Promise<void> {
    const boxes = STORAGE_TIERS.flatMap((tier) =>
      Array.from({ length: counts[tier] ?? 0 }, () => ({
        vendorId: inbound.vendorId,
        warehouseId: inbound.warehouseId,
        inboundId: inbound.id,
        tier,
        receivedAt,
        nextBillingDate: addDays(startOfUtcDay(receivedAt), BILLING_CYCLE_DAYS),
      })),
    );
    await tx.storageBox.createMany({ data: boxes });
  }
}
