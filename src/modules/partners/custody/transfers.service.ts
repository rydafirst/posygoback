import { Injectable } from "@nestjs/common";

import type { AuthPrincipal, RequestMeta } from "../../../common/auth/auth-principal";
import { Errors } from "../../../common/http/app-exception";
import { lockRow, PrismaService } from "../../../database/prisma.service";
import type { Prisma } from "../../../generated/prisma/client";
import { AuditService } from "../../../infrastructure/audit/audit.service";
import type { CreateTransferInput, TransferStatus, TransferView } from "../../../shared";
import { reviewerCountryScope } from "../../onboarding/scope";
import { randomCode } from "../../stock/inbound/references";
import { warehouseScope } from "../../stock/scope";
import { actorOf } from "../admin/admin-partners.service";
import { PartnerCapacityService } from "../operations/partner-capacity.service";
import { PartnerNotifierService } from "../partner-notifier.service";
import { CustodyEmails } from "./custody-emails";
import { TRANSFER_INCLUDE, type TransferRow, toTransferView } from "./custody.repository";

export const OPEN_TRANSFER_STATUSES: TransferStatus[] = ["REQUESTED", "DISPATCHED"];

@Injectable()
export class TransfersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly capacity: PartnerCapacityService,
    private readonly notifier: PartnerNotifierService,
    private readonly audit: AuditService,
  ) {}

  async create(principal: AuthPrincipal, input: CreateTransferInput, meta: RequestMeta): Promise<TransferView> {
    const country = reviewerCountryScope(principal);
    const inCountry = country ? { countryCode: country } : {};
    const [from, to] = await Promise.all([
      this.prisma.warehouse.findFirst({ where: { id: input.fromWarehouseId, ...inCountry }, select: { id: true, countryCode: true, partnerId: true, name: true } }),
      this.prisma.warehouse.findFirst({ where: { id: input.toWarehouseId, ...inCountry, active: true }, select: { id: true, countryCode: true, partnerId: true, name: true } }),
    ]);
    if (!from || !to) {
      throw Errors.notFound();
    }
    if (from.id === to.id || from.countryCode !== to.countryCode) {
      throw Errors.validation({ toWarehouseId: ["Choose a different hub or warehouse in the same country"] });
    }
    const id = await this.prisma.$transaction(async (tx) => {
      const lots = await tx.stockLot.findMany({
        where: {
          warehouseId: from.id,
          quantityAvailable: { gt: 0 },
          quantityReserved: 0,
          transferLines: { none: { transfer: { status: { in: OPEN_TRANSFER_STATUSES } } } },
          ...(input.lotIds ? { id: { in: input.lotIds } } : {}),
        },
        select: { id: true, quantityAvailable: true, product: { select: { name: true, declaredValueMinor: true } } },
      });
      if (input.lotIds && lots.length !== new Set(input.lotIds).size) {
        throw Errors.validation({ lotIds: ["Some of this stock is held for orders or already moving"] });
      }
      if (lots.length === 0) {
        throw Errors.invalidTransition("There's no free stock to move from there.");
      }
      await this.capacity.assertCanTake(
        tx,
        to.id,
        lots.map((lot) => ({ name: lot.product.name, unitValueMinor: lot.product.declaredValueMinor, quantity: lot.quantityAvailable })),
      );
      const transfer = await tx.stockTransfer.create({
        data: {
          reference: `TR-${from.countryCode}-${randomCode(6)}`,
          countryCode: from.countryCode,
          fromWarehouseId: from.id,
          toWarehouseId: to.id,
          reason: input.reason,
          requestedBy: principal.userId,
        },
      });
      await tx.stockTransferLine.createMany({ data: lots.map((lot) => ({ transferId: transfer.id, lotId: lot.id, quantitySent: lot.quantityAvailable })) });
      await this.audit.record(
        {
          actor: actorOf(principal),
          action: "custody.transfer_requested",
          resourceType: "stock_transfer",
          resourceId: transfer.id,
          countryCode: from.countryCode,
          after: { from: from.id, to: to.id, lots: lots.length, reason: input.reason },
          meta,
        },
        tx,
      );
      return transfer.id;
    });
    if (from.partnerId) {
      const view = await this.adminDetail(principal, id);
      await this.notifier.notify(from.partnerId, (recipient) => CustodyEmails.transferRequested(recipient, view.reference, to.name));
    }
    return this.adminDetail(principal, id);
  }

  async cancel(principal: AuthPrincipal, transferId: string, meta: RequestMeta): Promise<TransferView> {
    const transfer = await this.adminDetail(principal, transferId);
    const cancelled = await this.prisma.stockTransfer.updateMany({ where: { id: transferId, status: "REQUESTED" }, data: { status: "CANCELLED" } });
    if (cancelled.count === 0) {
      throw Errors.invalidTransition("Only transfers that haven't left can be cancelled.");
    }
    await this.audit.record({ actor: actorOf(principal), action: "custody.transfer_cancelled", resourceType: "stock_transfer", resourceId: transferId, countryCode: transfer.countryCode, meta });
    return this.adminDetail(principal, transferId);
  }

  async listForAdmin(principal: AuthPrincipal, status?: TransferStatus): Promise<TransferView[]> {
    const country = reviewerCountryScope(principal);
    const rows = await this.prisma.stockTransfer.findMany({
      where: { ...(country ? { countryCode: country } : {}), ...(status ? { status } : {}) },
      include: TRANSFER_INCLUDE,
      orderBy: { createdAt: "desc" },
      take: 100,
    });
    return rows.map((row) => toTransferView(row, row.status === "REQUESTED" ? ["CANCEL"] : [], true));
  }

  async adminDetail(principal: AuthPrincipal, transferId: string): Promise<TransferView> {
    const country = reviewerCountryScope(principal);
    const row = await this.prisma.stockTransfer.findFirst({ where: { id: transferId, ...(country ? { countryCode: country } : {}) }, include: TRANSFER_INCLUDE });
    if (!row) {
      throw Errors.notFound();
    }
    return toTransferView(row, row.status === "REQUESTED" ? ["CANCEL"] : [], true);
  }

  async listForHub(principal: AuthPrincipal): Promise<TransferView[]> {
    const scope = warehouseScope(principal);
    const rows = await this.prisma.stockTransfer.findMany({
      where: { status: { not: "CANCELLED" }, OR: [{ fromWarehouse: scope }, { toWarehouse: { ...scope }, status: { in: ["DISPATCHED", "RECEIVED"] } }] },
      include: TRANSFER_INCLUDE,
      orderBy: { createdAt: "desc" },
      take: 100,
    });
    return Promise.all(rows.map((row) => this.hubView(principal, row)));
  }

  async hubDetail(principal: AuthPrincipal, transferId: string): Promise<TransferView> {
    return this.hubView(principal, await this.hubRow(principal, transferId));
  }

  async hubRow(principal: AuthPrincipal, transferId: string, client: Prisma.TransactionClient | PrismaService = this.prisma): Promise<TransferRow> {
    const scope = warehouseScope(principal);
    const row = await client.stockTransfer.findFirst({
      where: { id: transferId, status: { not: "CANCELLED" }, OR: [{ fromWarehouse: scope }, { toWarehouse: scope, status: { in: ["DISPATCHED", "RECEIVED"] } }] },
      include: TRANSFER_INCLUDE,
    });
    if (!row) {
      throw Errors.notFound();
    }
    return row;
  }

  async lockedRow(tx: Prisma.TransactionClient, principal: AuthPrincipal, transferId: string): Promise<TransferRow> {
    await this.hubRow(principal, transferId, tx);
    await lockRow(tx, "stockTransfers", transferId);
    return this.hubRow(principal, transferId, tx);
  }

  private async hubView(principal: AuthPrincipal, row: TransferRow): Promise<TransferView> {
    const scope = warehouseScope(principal);
    const [sends, receives] = await Promise.all([
      this.prisma.warehouse.count({ where: { id: row.fromWarehouseId, ...scope } }),
      this.prisma.warehouse.count({ where: { id: row.toWarehouseId, ...scope } }),
    ]);
    const actions: TransferView["actions"] = [];
    if (sends > 0 && row.status === "REQUESTED") {
      actions.push("DISPATCH");
    }
    if (receives > 0 && row.status === "DISPATCHED" && row.dispatchedBy !== principal.userId) {
      actions.push("RECEIVE");
    }
    const view = toTransferView(row, actions, false);
    const blind = receives > 0 && row.status === "DISPATCHED";
    return blind ? { ...view, units: null, lines: view.lines.map((line) => ({ ...line, quantitySent: null })) } : view;
  }
}
