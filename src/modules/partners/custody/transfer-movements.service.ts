import { Injectable } from "@nestjs/common";

import type { AuthPrincipal, RequestMeta } from "../../../common/auth/auth-principal";
import { Errors } from "../../../common/http/app-exception";
import { lockRow, PrismaService } from "../../../database/prisma.service";
import type { Prisma } from "../../../generated/prisma/client";
import { AuditService } from "../../../infrastructure/audit/audit.service";
import type { DispatchTransferInput, ReceiveTransferInput, TransferView } from "../../../shared";
import { FilesService } from "../../files/files.service";
import { InventoryLedgerService } from "../../stock/inventory/inventory-ledger.service";
import { actorOf } from "../admin/admin-partners.service";
import { PartnerNotifierService } from "../partner-notifier.service";
import { ClaimsService } from "./claims.service";
import { CustodyEmails } from "./custody-emails";
import type { TransferRow } from "./custody.repository";
import { TransfersService } from "./transfers.service";

@Injectable()
export class TransferMovementsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly transfers: TransfersService,
    private readonly inventory: InventoryLedgerService,
    private readonly claims: ClaimsService,
    private readonly files: FilesService,
    private readonly notifier: PartnerNotifierService,
    private readonly audit: AuditService,
  ) {}

  async dispatch(principal: AuthPrincipal, transferId: string, input: DispatchTransferInput, meta: RequestMeta): Promise<TransferView> {
    await this.assertPhotos(principal.userId, input.photoFileIds);
    const transfer = await this.prisma.$transaction(async (tx) => {
      const transfer = await this.transfers.lockedRow(tx, principal, transferId);
      if (!(await this.transfers.hubDetail(principal, transferId)).actions.includes("DISPATCH") || transfer.status !== "REQUESTED") {
        throw Errors.invalidTransition("This transfer isn't waiting to be sent from your hub.");
      }
      let sent = 0;
      for (const line of transfer.lines) {
        await lockRow(tx, "stockLots", line.lotId);
        const lot = await tx.stockLot.findUniqueOrThrow({
          where: { id: line.lotId },
          select: { id: true, vendorId: true, warehouseId: true, quantityAvailable: true, quantityReserved: true, locationId: true },
        });
        if (lot.warehouseId !== transfer.fromWarehouseId || lot.quantityReserved > 0 || lot.quantityAvailable === 0) {
          await tx.stockTransferLine.delete({ where: { id: line.id } });
          continue;
        }
        const quantity = lot.quantityAvailable;
        await tx.stockTransferLine.update({ where: { id: line.id }, data: { quantitySent: quantity } });
        await tx.stockLot.update({ where: { id: lot.id }, data: { quantityAvailable: 0 } });
        await this.inventory.record(
          tx,
          lot,
          principal.userId,
          { type: "TRANSFER_OUT", deltaAvailable: -quantity, reason: `Transfer ${transfer.reference}`, reference: { type: "stock_transfer", id: transfer.id } },
          { type: "TRANSFERRED_OUT", quantity, fromLocationId: lot.locationId, evidenceFileIds: input.photoFileIds },
        );
        sent += quantity;
      }
      if (sent === 0) {
        throw Errors.invalidTransition("None of this stock is free to send any more. Ask us to cancel the transfer.");
      }
      await tx.stockTransfer.update({
        where: { id: transferId },
        data: {
          status: "DISPATCHED",
          carrier: input.carrier,
          trackingNumber: input.trackingNumber,
          sealNumber: input.sealNumber,
          dispatchFileIds: input.photoFileIds,
          dispatchedBy: principal.userId,
          dispatchedAt: new Date(),
        },
      });
      await this.audit.record(
        {
          actor: actorOf(principal),
          action: "custody.transfer_dispatched",
          resourceType: "stock_transfer",
          resourceId: transferId,
          countryCode: transfer.countryCode,
          after: { units: sent, seal: input.sealNumber },
          meta,
        },
        tx,
      );
      return transfer;
    });
    await this.announceDispatch(transfer, input);
    return this.transfers.hubDetail(principal, transferId);
  }

  async receive(principal: AuthPrincipal, transferId: string, input: ReceiveTransferInput, meta: RequestMeta): Promise<TransferView> {
    const claimIds = await this.prisma.$transaction(async (tx) => {
      const transfer = await this.transfers.lockedRow(tx, principal, transferId);
      if (!(await this.transfers.hubDetail(principal, transferId)).actions.includes("RECEIVE") || transfer.status !== "DISPATCHED") {
        throw Errors.invalidTransition("This transfer isn't waiting to be received by you.");
      }
      const counted = new Map(input.lines.map((line) => [line.lineId, line.quantityReceived]));
      if (counted.size !== transfer.lines.length || transfer.lines.some((line) => !counted.has(line.id))) {
        throw Errors.validation({ lines: ["Count every item in the delivery"] });
      }
      if (transfer.lines.some((line) => counted.get(line.id)! > line.quantitySent)) {
        throw Errors.validation({ lines: ["You've counted more than we sent for one item. Count it again, or report the extra stock to us."] });
      }
      const fromPartner = await tx.warehouse.findUniqueOrThrow({ where: { id: transfer.fromWarehouseId }, select: { partnerId: true } });
      const opened: string[] = [];
      for (const line of transfer.lines) {
        const claimId = await this.receiveLine(tx, principal, transfer, line, counted.get(line.id)!, fromPartner.partnerId);
        if (claimId) {
          opened.push(claimId);
        }
      }
      await this.moveBoxes(tx, transfer);
      await tx.stockTransfer.update({ where: { id: transferId }, data: { status: "RECEIVED", receivedBy: principal.userId, receivedAt: new Date() } });
      const short = transfer.lines.reduce((total, line) => total + line.quantitySent - counted.get(line.id)!, 0);
      await this.audit.record(
        { actor: actorOf(principal), action: "custody.transfer_received", resourceType: "stock_transfer", resourceId: transferId, countryCode: transfer.countryCode, after: { short }, meta },
        tx,
      );
      return opened;
    });
    await this.claims.announceOpened(claimIds);
    return this.transfers.hubDetail(principal, transferId);
  }

  private async receiveLine(
    tx: Prisma.TransactionClient,
    principal: AuthPrincipal,
    transfer: TransferRow,
    line: TransferRow["lines"][number],
    received: number,
    fromPartnerId: string | null,
  ): Promise<string | null> {
    await lockRow(tx, "stockLots", line.lotId);
    await tx.stockTransferLine.update({ where: { id: line.id }, data: { quantityReceived: received } });
    const lot = await tx.stockLot.update({
      where: { id: line.lotId },
      data: { warehouseId: transfer.toWarehouseId, locationId: null, quantityAvailable: { increment: received } },
      select: { id: true, vendorId: true, warehouseId: true, product: { select: { declaredValueMinor: true, currency: true } } },
    });
    if (received > 0) {
      await this.inventory.record(
        tx,
        lot,
        principal.userId,
        { type: "TRANSFER_IN", deltaAvailable: received, reason: `Transfer ${transfer.reference}`, reference: { type: "stock_transfer", id: transfer.id } },
        { type: "TRANSFERRED_IN", quantity: received },
      );
    }
    const missing = line.quantitySent - received;
    if (missing <= 0) {
      return null;
    }
    return this.claims.open(tx, {
      kind: "SHORTAGE",
      source: "TRANSFER",
      vendorId: lot.vendorId,
      warehouseId: transfer.fromWarehouseId,
      partnerId: fromPartnerId,
      countryCode: transfer.countryCode,
      lotId: lot.id,
      orderId: null,
      transferId: transfer.id,
      quantity: missing,
      unitValueMinor: lot.product.declaredValueMinor,
      currency: lot.product.currency,
      description: `${missing} of ${line.quantitySent} ${line.quantitySent === 1 ? "unit" : "units"} of ${line.lot.product.name} didn't arrive with transfer ${transfer.reference} (seal ${transfer.sealNumber ?? "not recorded"}).`,
      createdBy: null,
    });
  }

  private async announceDispatch(transfer: TransferRow, input: DispatchTransferInput): Promise<void> {
    const [from, to] = await Promise.all([
      this.prisma.warehouse.findUniqueOrThrow({ where: { id: transfer.fromWarehouseId }, select: { name: true } }),
      this.prisma.warehouse.findUniqueOrThrow({ where: { id: transfer.toWarehouseId }, select: { partnerId: true } }),
    ]);
    if (to.partnerId) {
      await this.notifier.notify(to.partnerId, (recipient, webUrl) => CustodyEmails.transferIncoming(recipient, transfer.reference, from.name, input.carrier, input.trackingNumber, webUrl));
    }
  }

  private async moveBoxes(tx: Prisma.TransactionClient, transfer: TransferRow): Promise<void> {
    const inbounds = await tx.stockLot.findMany({ where: { id: { in: transfer.lines.map((line) => line.lotId) } }, select: { inboundId: true }, distinct: ["inboundId"] });
    for (const { inboundId } of inbounds) {
      const left = await tx.stockLot.count({ where: { inboundId, warehouseId: transfer.fromWarehouseId, OR: [{ quantityAvailable: { gt: 0 } }, { quantityReserved: { gt: 0 } }] } });
      if (left === 0) {
        await tx.storageBox.updateMany({ where: { inboundId, warehouseId: transfer.fromWarehouseId, removedAt: null }, data: { warehouseId: transfer.toWarehouseId } });
      }
    }
  }

  private async assertPhotos(userId: string, fileIds: readonly string[]): Promise<void> {
    const [evidence, partner] = await Promise.all([this.files.uploadedBy(userId, fileIds, "EVIDENCE_PHOTO"), this.files.uploadedBy(userId, fileIds, "PARTNER_EVIDENCE")]);
    if (fileIds.some((id) => evidence.get(id) !== "VERIFIED" && partner.get(id) !== "VERIFIED")) {
      throw Errors.validation({ photoFileIds: ["Wait for every photo to finish uploading"] });
    }
  }
}
