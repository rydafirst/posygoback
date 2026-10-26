import { Injectable } from "@nestjs/common";

import type { AuthPrincipal, RequestMeta } from "../../common/auth/auth-principal";
import { Errors } from "../../common/http/app-exception";
import { lockRow, PrismaService } from "../../database/prisma.service";
import type { Prisma } from "../../generated/prisma/client";
import { AuditService } from "../../infrastructure/audit/audit.service";
import {
  type CreateVendorReturnInput,
  type InstructVendorReturnInput,
  RETURN_RULES,
  type ReturnableOrderView,
  type VendorReturnStatus,
  type VendorReturnTrackingInput,
  type VendorReturnView,
} from "../../shared";
import { FeeSchedulesService } from "../finance/fees/fee-schedules.service";
import { FilesService } from "../files/files.service";
import { vendorIdOf } from "../onboarding/scope";
import { VendorStandingService } from "../onboarding/vendor-standing.service";
import { randomCode } from "../stock/inbound/references";
import { ReturnFeesService } from "./return-fees.service";
import { addDays, VendorReturnsRepository } from "./vendor-returns.repository";

const SENT_STATUSES = ["HANDED_OFF", "IN_TRANSIT", "DELIVERED", "EXCEPTION"] as const;

@Injectable()
export class VendorReturnsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly repository: VendorReturnsRepository,
    private readonly standing: VendorStandingService,
    private readonly fees: FeeSchedulesService,
    private readonly charges: ReturnFeesService,
    private readonly files: FilesService,
    private readonly audit: AuditService,
  ) {}

  list(principal: AuthPrincipal, status?: VendorReturnStatus): Promise<VendorReturnView[]> {
    return this.repository.list({ vendorId: vendorIdOf(principal), ...(status ? { status } : {}) }, "VENDOR");
  }

  async detail(principal: AuthPrincipal, returnId: string): Promise<VendorReturnView> {
    return this.repository.view(await this.owned(principal, returnId), "VENDOR");
  }

  async returnable(principal: AuthPrincipal, orderId: string): Promise<ReturnableOrderView> {
    const vendorId = vendorIdOf(principal);
    const order = await this.sentOrder(this.prisma, vendorId, orderId);
    const counted = await this.repository.returnedSoFar(this.prisma, order.id);
    const fee = (await this.fees.active(order.originCountryCode)).schedule.returnsHandlingMinor;
    return {
      orderId: order.id,
      orderReference: order.reference,
      returnableUntil: addDays(order.handedOffAt!, RETURN_RULES.windowDays).toISOString(),
      feeMinor: fee,
      currency: order.currency,
      lines: order.lines.map((line) => ({
        lineId: line.id,
        productName: line.productName,
        productCode: line.productCode,
        shippedQuantity: line.quantity,
        returnableQuantity: Math.max(0, line.quantity - (counted.get(line.id) ?? 0)),
      })),
    };
  }

  async create(principal: AuthPrincipal, input: CreateVendorReturnInput, meta: RequestMeta): Promise<VendorReturnView> {
    const vendor = await this.standing.assertCanTrade(principal);
    const id = await this.prisma.$transaction(async (tx) => {
      if (!(await lockRow(tx, "orders", input.orderId))) {
        throw Errors.notFound();
      }
      const order = await this.sentOrder(tx, vendor.vendorId, input.orderId);
      if (addDays(order.handedOffAt!, RETURN_RULES.windowDays) <= new Date()) {
        throw Errors.invalidTransition(`Returns can be opened up to ${RETURN_RULES.windowDays} days after an order leaves the warehouse.`);
      }
      const counted = await this.repository.returnedSoFar(tx, order.id);
      const problems: Record<string, string[]> = {};
      input.lines.forEach((requested, index) => {
        const line = order.lines.find((candidate) => candidate.id === requested.lineId);
        if (!line) {
          problems[`lines.${index}.lineId`] = ["That item isn't on this order"];
        } else if (requested.quantity > line.quantity - (counted.get(line.id) ?? 0)) {
          problems[`lines.${index}.quantity`] = [`Only ${Math.max(0, line.quantity - (counted.get(line.id) ?? 0))} of ${line.productName} can still be returned`];
        }
      });
      if (Object.keys(problems).length > 0) {
        throw Errors.validation(problems);
      }
      const feeMinor = (await this.fees.active(order.originCountryCode, tx)).schedule.returnsHandlingMinor;
      const created = await tx.vendorReturn.create({
        data: {
          reference: `RMA-${order.originCountryCode}-${randomCode(8)}`,
          vendorId: vendor.vendorId,
          orderId: order.id,
          warehouseId: order.warehouseId,
          countryCode: order.originCountryCode,
          reason: input.reason,
          carrier: input.carrier ?? null,
          trackingNumber: input.trackingNumber ?? null,
          feeMinor: BigInt(feeMinor),
          currency: order.currency,
          createdBy: principal.userId,
          lines: {
            create: input.lines.map((requested) => ({
              orderLineId: requested.lineId,
              productId: order.lines.find((line) => line.id === requested.lineId)!.productId,
              requestedQuantity: requested.quantity,
            })),
          },
        },
      });
      await this.charges.charge(tx, created, principal.userId);
      await this.audit.record(
        { actor: this.actor(principal), action: "return.requested", resourceType: "vendor_return", resourceId: created.id, vendorId: vendor.vendorId, countryCode: order.originCountryCode, meta },
        tx,
      );
      return created.id;
    });
    return this.detail(principal, id);
  }

  async addTracking(principal: AuthPrincipal, returnId: string, input: VendorReturnTrackingInput): Promise<VendorReturnView> {
    const entry = await this.owned(principal, returnId);
    const updated = await this.prisma.vendorReturn.updateMany({ where: { id: entry.id, status: "REQUESTED" }, data: { carrier: input.carrier, trackingNumber: input.trackingNumber } });
    if (updated.count === 0) {
      throw Errors.invalidTransition("Tracking can only be added before the return arrives.");
    }
    return this.detail(principal, returnId);
  }

  async cancel(principal: AuthPrincipal, returnId: string, meta: RequestMeta): Promise<VendorReturnView> {
    const entry = await this.owned(principal, returnId);
    await this.prisma.$transaction(async (tx) => {
      await lockRow(tx, "vendorReturns", entry.id);
      const cancelled = await tx.vendorReturn.updateMany({ where: { id: entry.id, status: "REQUESTED" }, data: { status: "CANCELLED" } });
      if (cancelled.count === 0) {
        throw Errors.invalidTransition("This return has already arrived at the warehouse, so it can't be cancelled.");
      }
      await this.charges.giveBack(tx, entry, "cancelled");
      await this.audit.record({ actor: this.actor(principal), action: "return.cancelled", resourceType: "vendor_return", resourceId: entry.id, vendorId: entry.vendorId, meta }, tx);
    });
    return this.detail(principal, returnId);
  }

  async instruct(principal: AuthPrincipal, returnId: string, input: InstructVendorReturnInput, meta: RequestMeta): Promise<VendorReturnView> {
    const entry = await this.owned(principal, returnId);
    await this.prisma.$transaction(async (tx) => {
      await lockRow(tx, "vendorReturns", entry.id);
      const current = await tx.vendorReturn.findUniqueOrThrow({ where: { id: entry.id }, include: { lines: true } });
      if (current.status !== "RECEIVED") {
        throw Errors.invalidTransition("Instructions can only be given once the return has arrived and before it's finished.");
      }
      const problems: Record<string, string[]> = {};
      for (const line of current.lines.filter((candidate) => (candidate.receivedQuantity ?? 0) > 0)) {
        const split = input.lines.find((candidate) => candidate.lineId === line.id);
        if (!split || split.restock + split.dispose + split.donate !== line.receivedQuantity) {
          problems[`lines.${line.id}`] = [`Choose what happens to all ${line.receivedQuantity} received`];
        }
      }
      if (input.lines.some((split) => !current.lines.some((line) => line.id === split.lineId))) {
        problems.lines = ["One of these items isn't on this return"];
      }
      if (Object.keys(problems).length > 0) {
        throw Errors.validation(problems);
      }
      for (const split of input.lines) {
        await tx.vendorReturnLine.update({ where: { id: split.lineId }, data: { restockQuantity: split.restock, disposeQuantity: split.dispose, donateQuantity: split.donate } });
      }
      await tx.vendorReturn.update({ where: { id: entry.id }, data: { status: "INSTRUCTED", instructedBy: principal.userId, instructedAt: new Date() } });
      await this.audit.record({ actor: this.actor(principal), action: "return.instructed", resourceType: "vendor_return", resourceId: entry.id, vendorId: entry.vendorId, after: input, meta }, tx);
    });
    return this.detail(principal, returnId);
  }

  async photoUrl(principal: AuthPrincipal, returnId: string, fileId: string, meta: RequestMeta) {
    const entry = await this.owned(principal, returnId);
    if (!(entry.photoFileIds as string[]).includes(fileId)) {
      throw Errors.notFound();
    }
    return this.files.linkedDownloadUrl(fileId, "EVIDENCE_PHOTO", principal, meta);
  }

  private async owned(principal: AuthPrincipal, returnId: string) {
    const entry = await this.repository.find({ id: returnId, vendorId: vendorIdOf(principal) });
    if (!entry) {
      throw Errors.notFound();
    }
    return entry;
  }

  private async sentOrder(client: Prisma.TransactionClient | PrismaService, vendorId: string, orderId: string) {
    const order = await client.order.findFirst({ where: { id: orderId, vendorId }, include: { lines: { orderBy: { productName: "asc" } } } });
    if (!order) {
      throw Errors.notFound();
    }
    if (!(SENT_STATUSES as readonly string[]).includes(order.status) || !order.handedOffAt) {
      throw Errors.invalidTransition("Only orders that have left the warehouse can be returned.");
    }
    return order;
  }

  private actor(principal: AuthPrincipal) {
    return { userId: principal.userId, role: principal.role };
  }
}
