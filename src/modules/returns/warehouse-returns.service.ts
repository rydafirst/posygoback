import { Injectable } from "@nestjs/common";

import type { AuthPrincipal, RequestMeta } from "../../common/auth/auth-principal";
import { Errors } from "../../common/http/app-exception";
import { lockRow, PrismaService } from "../../database/prisma.service";
import type { Prisma } from "../../generated/prisma/client";
import { AuditService } from "../../infrastructure/audit/audit.service";
import { RETURN_RULES, type ReceiveVendorReturnInput, type VendorReturnStatus, type VendorReturnView } from "../../shared";
import { FilesService } from "../files/files.service";
import { randomCode } from "../stock/inbound/references";
import { InventoryLedgerService } from "../stock/inventory/inventory-ledger.service";
import { warehouseScope } from "../stock/scope";
import { ReturnAlertsService } from "./return-alerts.service";
import { ReturnEmails } from "./return-emails";
import { addDays, VendorReturnsRepository } from "./vendor-returns.repository";

function longDate(date: Date): string {
  return new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" }).format(date);
}

const RETURNABLE_ORDER_STATUSES = ["HANDED_OFF", "IN_TRANSIT", "DELIVERED", "EXCEPTION"];

@Injectable()
export class WarehouseReturnsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly repository: VendorReturnsRepository,
    private readonly inventory: InventoryLedgerService,
    private readonly files: FilesService,
    private readonly owners: ReturnAlertsService,
    private readonly audit: AuditService,
  ) {}

  list(principal: AuthPrincipal, status?: VendorReturnStatus): Promise<VendorReturnView[]> {
    return this.repository.list({ warehouse: warehouseScope(principal), ...(status ? { status } : {}) }, "WAREHOUSE");
  }

  async detail(principal: AuthPrincipal, returnId: string): Promise<VendorReturnView> {
    return this.repository.view(await this.scoped(principal, returnId), "WAREHOUSE");
  }

  async receive(principal: AuthPrincipal, returnId: string, input: ReceiveVendorReturnInput, meta: RequestMeta): Promise<VendorReturnView> {
    const entry = await this.scoped(principal, returnId);
    const photos = await this.files.uploadedBy(principal.userId, input.photoFileIds, "EVIDENCE_PHOTO");
    if (input.photoFileIds.some((id) => photos.get(id) !== "VERIFIED")) {
      throw Errors.validation({ photoFileIds: ["Wait for every photo to finish uploading"] });
    }
    const received = await this.prisma.$transaction(async (tx) => {
      await lockRow(tx, "vendorReturns", entry.id);
      const current = await tx.vendorReturn.findUniqueOrThrow({ where: { id: entry.id }, include: { lines: true } });
      if (current.status !== "REQUESTED") {
        throw Errors.invalidTransition("This return has already been received.");
      }
      const problems: Record<string, string[]> = {};
      for (const line of current.lines) {
        const counted = input.lines.find((candidate) => candidate.lineId === line.id);
        if (!counted) {
          problems[`lines.${line.id}`] = ["Count every item on the return, even if none arrived"];
        } else if (counted.receivedQuantity > line.requestedQuantity) {
          problems[`lines.${line.id}`] = [`Only ${line.requestedQuantity} were expected. Open a claim or a new return for anything extra`];
        }
      }
      if (input.lines.some((counted) => !current.lines.some((line) => line.id === counted.lineId)) || Object.keys(problems).length > 0) {
        throw Errors.validation(Object.keys(problems).length > 0 ? problems : { lines: ["One of these items isn't on this return"] });
      }
      for (const counted of input.lines) {
        await tx.vendorReturnLine.update({ where: { id: counted.lineId }, data: { receivedQuantity: counted.receivedQuantity } });
      }
      const total = input.lines.reduce((sum, counted) => sum + counted.receivedQuantity, 0);
      const now = new Date();
      await tx.vendorReturn.update({
        where: { id: entry.id },
        data: {
          status: total > 0 ? "RECEIVED" : "COMPLETED",
          receivedBy: principal.userId,
          receivedAt: now,
          receiveNotes: input.notes ?? null,
          photoFileIds: input.photoFileIds,
          ...(total > 0 ? {} : { instructedAt: now, completedBy: principal.userId, completedAt: now }),
        },
      });
      await this.audit.record(
        {
          actor: this.actor(principal),
          action: "return.received",
          resourceType: "vendor_return",
          resourceId: entry.id,
          vendorId: entry.vendorId,
          countryCode: entry.countryCode,
          after: { total },
          meta,
        },
        tx,
      );
      return { total, now };
    });
    if (received.total > 0) {
      const by = longDate(addDays(received.now, RETURN_RULES.instructionDays));
      await this.owners.tellOwner(entry, (to, webUrl) => ReturnEmails.arrived(to, entry.reference, received.total, by, webUrl));
    } else {
      await this.owners.tellOwner(entry, (to, webUrl) => ReturnEmails.arrivedEmpty(to, entry.reference, webUrl));
    }
    return this.detail(principal, returnId);
  }

  async complete(principal: AuthPrincipal, returnId: string, meta: RequestMeta): Promise<VendorReturnView> {
    const entry = await this.scoped(principal, returnId);
    const restocked = await this.prisma.$transaction(async (tx) => {
      await lockRow(tx, "vendorReturns", entry.id);
      const current = await tx.vendorReturn.findUniqueOrThrow({
        where: { id: entry.id },
        include: { lines: { include: { product: true, orderLine: { include: { allocations: { include: { lot: true } } } } } } },
      });
      if (current.status !== "INSTRUCTED") {
        throw Errors.invalidTransition("This return is waiting for the vendor's instructions.");
      }
      let total = 0;
      for (const line of current.lines.filter((candidate) => candidate.restockQuantity > 0)) {
        const source = line.orderLine.allocations[0]?.lot;
        if (!source) {
          throw Errors.invalidTransition(`We can't trace where ${line.product.name} came from, so it can't be restocked automatically.`);
        }
        const lot = await tx.stockLot.create({
          data: {
            code: `RT-${current.countryCode}-${randomCode(8)}`,
            vendorId: current.vendorId,
            productId: line.productId,
            warehouseId: current.warehouseId,
            inboundId: source.inboundId,
            condition: "SELLABLE",
            storageTier: line.product.storageTier,
            quantityAvailable: line.restockQuantity,
            receivedAt: new Date(),
          },
        });
        await this.inventory.record(
          tx,
          lot,
          principal.userId,
          { type: "RETURN_IN", deltaAvailable: line.restockQuantity, reason: `Return ${current.reference}`, reference: { type: "vendor_return", id: current.id } },
          { type: "RETURNED", quantity: line.restockQuantity, evidenceFileIds: current.photoFileIds as string[] },
        );
        await tx.vendorReturnLine.update({ where: { id: line.id }, data: { restockLotId: lot.id } });
        total += line.restockQuantity;
      }
      await tx.vendorReturn.update({ where: { id: current.id }, data: { status: "COMPLETED", completedBy: principal.userId, completedAt: new Date() } });
      await this.markOrderReturned(tx, current.orderId);
      await this.audit.record(
        {
          actor: this.actor(principal),
          action: "return.completed",
          resourceType: "vendor_return",
          resourceId: current.id,
          vendorId: current.vendorId,
          countryCode: current.countryCode,
          after: { restocked: total },
          meta,
        },
        tx,
      );
      return total;
    });
    await this.owners.tellOwner(entry, (to, webUrl) => ReturnEmails.completed(to, entry.reference, restocked, webUrl));
    return this.detail(principal, returnId);
  }

  async photoUrl(principal: AuthPrincipal, returnId: string, fileId: string, meta: RequestMeta) {
    const entry = await this.scoped(principal, returnId);
    if (!(entry.photoFileIds as string[]).includes(fileId)) {
      throw Errors.notFound();
    }
    return this.files.linkedDownloadUrl(fileId, "EVIDENCE_PHOTO", principal, meta);
  }

  private async markOrderReturned(tx: Prisma.TransactionClient, orderId: string): Promise<void> {
    const order = await tx.order.findUniqueOrThrow({ where: { id: orderId }, include: { lines: true } });
    const received = await tx.vendorReturnLine.groupBy({ by: ["orderLineId"], where: { vendorReturn: { orderId, status: "COMPLETED" } }, _sum: { receivedQuantity: true } });
    const all = order.lines.every((line) => (received.find((row) => row.orderLineId === line.id)?._sum.receivedQuantity ?? 0) >= line.quantity);
    if (all && RETURNABLE_ORDER_STATUSES.includes(order.status)) {
      await tx.order.update({ where: { id: orderId }, data: { status: "RETURNED" } });
    }
  }

  private async scoped(principal: AuthPrincipal, returnId: string) {
    const entry = await this.repository.find({ id: returnId, warehouse: warehouseScope(principal) });
    if (!entry) {
      throw Errors.notFound();
    }
    return entry;
  }

  private actor(principal: AuthPrincipal) {
    return { userId: principal.userId, role: principal.role };
  }
}
