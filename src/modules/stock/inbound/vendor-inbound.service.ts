import { Injectable } from "@nestjs/common";

import type { AuthPrincipal, RequestMeta } from "../../../common/auth/auth-principal";
import { Errors } from "../../../common/http/app-exception";
import { lockRow, PrismaService } from "../../../database/prisma.service";
import type { Prisma } from "../../../generated/prisma/client";
import { AuditService } from "../../../infrastructure/audit/audit.service";
import {
  arrivalDateProblem,
  type InboundEstimateInput,
  type InboundEstimateView,
  canApplyInboundAction,
  hasPermission,
  type InboundAction,
  type InboundDetailView,
  type InboundInput,
  type InboundSummaryView,
  VENDOR_INBOUND_ACTIONS,
} from "../../../shared";
import { FilesService } from "../../files/files.service";
import { PartnerCapacityService } from "../../partners/operations/partner-capacity.service";
import { WalletAlertsService } from "../../finance/wallets/wallet-alerts.service";
import type { PostingResult } from "../../finance/wallets/wallet-ledger.service";
import { vendorIdOf } from "../../onboarding/scope";
import { VendorStandingService } from "../../onboarding/vendor-standing.service";
import { fromDateOnly, toDateOnly, todayIso, uniqueViolationModel } from "../scope";
import { WarehouseAccessService } from "../warehouses/warehouse-access.service";
import { InboundChargesService } from "./inbound-charges.service";
import { InboundRepository, type InboundRow } from "./inbound.repository";
import { inboundReference } from "./references";

const REFERENCE_ATTEMPTS = 5;

@Injectable()
export class VendorInboundService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly inbound: InboundRepository,
    private readonly standing: VendorStandingService,
    private readonly warehouses: WarehouseAccessService,
    private readonly files: FilesService,
    private readonly charges: InboundChargesService,
    private readonly capacity: PartnerCapacityService,
    private readonly alerts: WalletAlertsService,
    private readonly audit: AuditService,
  ) {}

  list(principal: AuthPrincipal): Promise<InboundSummaryView[]> {
    return this.inbound.summaries({ vendorId: vendorIdOf(principal) });
  }

  async detail(principal: AuthPrincipal, inboundId: string): Promise<InboundDetailView> {
    await this.owned(principal, inboundId);
    const detail = await this.inbound.detail(inboundId);
    const actions = hasPermission(principal.role, "vendor.stock.manage") ? VENDOR_INBOUND_ACTIONS.filter((action) => canApplyInboundAction(action, detail.status)) : [];
    return { ...detail, actions };
  }

  async create(principal: AuthPrincipal, input: InboundInput, meta: RequestMeta): Promise<InboundDetailView> {
    const vendor = await this.standing.assertCanTrade(principal);
    this.assertArrivalDate(input.expectedArrivalDate);
    const warehouse = await this.warehouses.receivingWarehouseFor(vendor.countryCode, input.warehouseId);
    await this.assertProducts(
      this.prisma,
      vendor.vendorId,
      input.lines.map((line) => line.productId),
    );
    for (let attempt = 1; ; attempt++) {
      try {
        const inboundId = await this.prisma.$transaction(async (tx) => {
          const created = await tx.inboundShipment.create({
            data: {
              ...this.columns(input),
              reference: inboundReference(vendor.countryCode),
              vendorId: vendor.vendorId,
              warehouseId: warehouse.id,
              countryCode: vendor.countryCode,
              createdBy: principal.userId,
              lines: { create: this.lineRows(input) },
            },
          });
          await this.record(tx, principal, created, "inbound.created", meta);
          return created.id;
        });
        return this.detail(principal, inboundId);
      } catch (error) {
        if (uniqueViolationModel(error) === null || attempt >= REFERENCE_ATTEMPTS) {
          throw error;
        }
      }
    }
  }

  async update(principal: AuthPrincipal, inboundId: string, input: InboundInput, meta: RequestMeta): Promise<InboundDetailView> {
    const vendor = await this.standing.assertCanTrade(principal);
    this.assertArrivalDate(input.expectedArrivalDate);
    const warehouse = await this.warehouses.receivingWarehouseFor(vendor.countryCode, input.warehouseId);
    await this.prisma.$transaction(async (tx) => {
      const existing = await this.lockOwned(tx, vendor.vendorId, inboundId);
      if (existing.status !== "DRAFT") {
        throw Errors.invalidTransition("Only draft shipments can be changed.");
      }
      await this.assertProducts(
        tx,
        vendor.vendorId,
        input.lines.map((line) => line.productId),
      );
      await tx.inboundLine.deleteMany({ where: { inboundId: existing.id } });
      await tx.inboundShipment.update({ where: { id: existing.id }, data: { ...this.columns(input), warehouseId: warehouse.id, lines: { create: this.lineRows(input) } } });
      await this.record(tx, principal, existing, "inbound.updated", meta);
    });
    return this.detail(principal, inboundId);
  }

  estimate(principal: AuthPrincipal, input: InboundEstimateInput): Promise<InboundEstimateView> {
    return this.charges.estimate(vendorIdOf(principal), principal.countryCode ?? "", input);
  }

  async apply(principal: AuthPrincipal, inboundId: string, action: InboundAction, meta: RequestMeta): Promise<InboundDetailView> {
    if (!VENDOR_INBOUND_ACTIONS.includes(action)) {
      throw Errors.notFound();
    }
    const vendorId = action === "SUBMIT" ? (await this.standing.assertCanTrade(principal)).vendorId : vendorIdOf(principal);
    const postings: PostingResult[] = [];
    await this.prisma.$transaction(async (tx) => {
      const existing = await this.lockOwned(tx, vendorId, inboundId);
      if (!canApplyInboundAction(action, existing.status)) {
        throw Errors.invalidTransition("This shipment can't be changed that way right now.");
      }
      const changes = await this.effects(tx, principal, existing, action, postings);
      const updated = await tx.inboundShipment.update({ where: { id: existing.id }, data: changes });
      await this.audit.record(
        {
          actor: { userId: principal.userId, role: principal.role },
          action: `inbound.${action.toLowerCase()}`,
          resourceType: "inbound_shipment",
          resourceId: existing.id,
          vendorId: existing.vendorId,
          countryCode: existing.countryCode,
          before: { status: existing.status },
          after: { status: updated.status, onboardingFeeMinor: updated.onboardingFeeMinor === null ? null : Number(updated.onboardingFeeMinor) },
          meta,
        },
        tx,
      );
    });
    for (const posting of postings) {
      await this.alerts.afterPosting(posting);
    }
    return this.detail(principal, inboundId);
  }

  private async effects(tx: Prisma.TransactionClient, principal: AuthPrincipal, existing: InboundRow, action: InboundAction, postings: PostingResult[]): Promise<Prisma.InboundShipmentUpdateInput> {
    if (action === "SUBMIT") {
      await this.validateSubmission(tx, existing);
      return this.charges.chargeOnboarding(tx, principal, existing, postings);
    }
    if (action === "PAY_HOLD") {
      return this.charges.payHold(tx, principal, existing, postings);
    }
    await this.charges.refundOnboarding(tx, principal, existing, postings);
    return { status: "CANCELLED" };
  }

  private async validateSubmission(tx: Prisma.TransactionClient, existing: InboundRow): Promise<void> {
    this.assertArrivalDate(fromDateOnly(existing.expectedArrivalDate));
    const lines = await tx.inboundLine.findMany({ where: { inboundId: existing.id }, select: { productId: true } });
    await this.assertProducts(
      tx,
      existing.vendorId,
      lines.map((line) => line.productId),
    );
    const warehouse = await tx.warehouse.findUnique({ where: { id: existing.warehouseId } });
    if (!warehouse?.active) {
      throw Errors.invalidTransition("That warehouse isn't taking deliveries right now. Edit the shipment to choose another.");
    }
    await this.capacity.assertCanAccept(tx, warehouse.id, existing.id);
  }

  async postMessage(principal: AuthPrincipal, inboundId: string, body: string, meta: RequestMeta): Promise<InboundDetailView> {
    const existing = await this.owned(principal, inboundId);
    if (existing.status === "DRAFT") {
      throw Errors.invalidTransition("Submit the shipment before messaging the warehouse.");
    }
    await this.prisma.$transaction(async (tx) => {
      await tx.inboundMessage.create({ data: { inboundId: existing.id, authorUserId: principal.userId, fromPlatform: false, body } });
      await this.audit.record(
        {
          actor: { userId: principal.userId, role: principal.role },
          action: "inbound.message_posted",
          resourceType: "inbound_shipment",
          resourceId: existing.id,
          vendorId: existing.vendorId,
          countryCode: existing.countryCode,
          meta,
        },
        tx,
      );
    });
    return this.detail(principal, inboundId);
  }

  async photoUrl(principal: AuthPrincipal, inboundId: string, fileId: string, meta: RequestMeta) {
    await this.owned(principal, inboundId);
    if (!(await this.inbound.hasPhoto(inboundId, fileId))) {
      throw Errors.notFound();
    }
    return this.files.linkedDownloadUrl(fileId, "EVIDENCE_PHOTO", principal, meta);
  }

  private async owned(principal: AuthPrincipal, inboundId: string): Promise<InboundRow> {
    const existing = await this.inbound.find(inboundId);
    if (!existing || existing.vendorId !== vendorIdOf(principal)) {
      throw Errors.notFound();
    }
    return existing;
  }

  private async lockOwned(tx: Prisma.TransactionClient, vendorId: string, inboundId: string): Promise<InboundRow> {
    await lockRow(tx, "inboundShipments", inboundId);
    const existing = await tx.inboundShipment.findFirst({ where: { id: inboundId, vendorId } });
    if (!existing) {
      throw Errors.notFound();
    }
    return existing;
  }

  private columns(input: InboundInput) {
    return {
      shippingMode: input.shippingMode,
      expectedArrivalDate: toDateOnly(input.expectedArrivalDate),
      carrier: input.carrier ?? null,
      trackingNumber: input.trackingNumber ?? null,
      notes: input.notes ?? null,
      declaredBoxCounts: input.boxCounts,
    };
  }

  private lineRows(input: InboundInput) {
    return input.lines.map((line) => ({ productId: line.productId, declaredQuantity: line.quantity }));
  }

  private assertArrivalDate(date: string): void {
    const problem = arrivalDateProblem(date, todayIso());
    if (problem) {
      throw Errors.validation({ expectedArrivalDate: [problem] });
    }
  }

  private async assertProducts(client: PrismaService | Prisma.TransactionClient, vendorId: string, productIds: readonly string[]): Promise<void> {
    const found = await client.product.count({ where: { vendorId, status: "ACTIVE", id: { in: [...productIds] } } });
    if (found !== new Set(productIds).size) {
      throw Errors.validation({ lines: ["Choose active products from your catalogue"] });
    }
  }

  private record(tx: Prisma.TransactionClient, principal: AuthPrincipal, inbound: InboundRow, action: string, meta: RequestMeta) {
    return this.audit.record(
      {
        actor: { userId: principal.userId, role: principal.role },
        action,
        resourceType: "inbound_shipment",
        resourceId: inbound.id,
        vendorId: inbound.vendorId,
        countryCode: inbound.countryCode,
        meta,
      },
      tx,
    );
  }
}
