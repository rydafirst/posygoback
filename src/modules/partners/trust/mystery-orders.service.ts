import { Injectable } from "@nestjs/common";

import type { AuthPrincipal, RequestMeta } from "../../../common/auth/auth-principal";
import { Errors } from "../../../common/http/app-exception";
import { PrismaService } from "../../../database/prisma.service";
import type { Prisma } from "../../../generated/prisma/client";
import { AuditService } from "../../../infrastructure/audit/audit.service";
import { type CreateMysteryOrderInput, type MysteryOrderView, type MysteryProductView, partnerProgramme } from "../../../shared";
import { VendorStandingService } from "../../onboarding/vendor-standing.service";
import { OrderCreationService } from "../../orders/core/order-creation.service";
import { actorOf, adminPartnerScope, AdminPartnersService } from "../admin/admin-partners.service";
import { SHIPPED_ORDER_STATUSES } from "../ledger/partner-earnings.service";

const MYSTERY_INCLUDE = { order: { select: { reference: true, status: true, handedOffAt: true } }, partner: { select: { legalName: true } } } satisfies Prisma.MysteryOrderInclude;

type MysteryRow = Prisma.MysteryOrderGetPayload<{ include: typeof MYSTERY_INCLUDE }>;

function toView(row: MysteryRow): MysteryOrderView {
  return {
    orderId: row.orderId,
    reference: row.order.reference,
    partnerId: row.partnerId,
    legalName: row.partner.legalName,
    orderStatus: row.order.status,
    outcome: row.outcome,
    outcomeNote: row.outcomeNote,
    createdAt: row.createdAt.toISOString(),
    handedOffAt: row.order.handedOffAt?.toISOString() ?? null,
  };
}

@Injectable()
export class MysteryOrdersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly admin: AdminPartnersService,
    private readonly standing: VendorStandingService,
    private readonly creation: OrderCreationService,
    private readonly audit: AuditService,
  ) {}

  async stockedProducts(principal: AuthPrincipal, partnerId: string): Promise<MysteryProductView[]> {
    const { vendorId, warehouseId } = await this.context(principal, partnerId);
    const lots = await this.prisma.stockLot.groupBy({ by: ["productId"], where: { vendorId, warehouseId, quantityAvailable: { gt: 0 } }, _sum: { quantityAvailable: true } });
    const products = await this.prisma.product.findMany({ where: { id: { in: lots.map((lot) => lot.productId) } }, select: { id: true, code: true, name: true }, orderBy: { name: "asc" } });
    const available = new Map(lots.map((lot) => [lot.productId, lot._sum.quantityAvailable ?? 0]));
    return products.map((product) => ({ productId: product.id, code: product.code, name: product.name, available: available.get(product.id) ?? 0 }));
  }

  async create(principal: AuthPrincipal, partnerId: string, input: CreateMysteryOrderInput, meta: RequestMeta): Promise<MysteryOrderView> {
    const { partner, vendorId, warehouseId } = await this.context(principal, partnerId);
    const vendor = await this.standing.assertVendorCanTrade(vendorId);
    const [orderId] = await this.creation.create(
      vendor,
      { userId: principal.userId, role: principal.role, apiKeyId: null },
      "PORTAL",
      [{ recipient: input.recipient, lines: [{ productId: input.productId, quantity: input.quantity }] }],
      warehouseId,
    );
    const row = await this.prisma.$transaction(async (tx) => {
      const created = await tx.mysteryOrder.create({ data: { orderId: orderId!, partnerId, createdBy: principal.userId }, include: MYSTERY_INCLUDE });
      await this.audit.record(
        { actor: actorOf(principal), action: "partner.mystery_order_created", resourceType: "order", resourceId: orderId!, countryCode: partner.countryCode, after: { partnerId }, meta },
        tx,
      );
      return created;
    });
    return toView(row);
  }

  private async context(principal: AuthPrincipal, partnerId: string) {
    const partner = await this.admin.scoped(principal, partnerId);
    if (partner.status !== "ACTIVE") {
      throw Errors.invalidTransition("Test orders are for active hubs.");
    }
    const country = await this.prisma.country.findUniqueOrThrow({ where: { code: partner.countryCode }, select: { config: true } });
    const vendorId = partnerProgramme(country.config as { partners?: unknown }).mysteryVendorId;
    if (!vendorId) {
      throw Errors.invalidTransition("Set the test vendor account in this country's partner settings first.");
    }
    const testVendor = await this.prisma.vendor.findFirst({ where: { id: vendorId, countryCode: partner.countryCode, isTestAccount: true }, select: { id: true } });
    if (!testVendor) {
      throw Errors.invalidTransition("The test vendor setting must point at an internal test account in this country.");
    }
    const warehouse = await this.prisma.warehouse.findFirst({ where: { partnerId, active: true }, orderBy: { createdAt: "asc" }, select: { id: true } });
    if (!warehouse) {
      throw Errors.invalidTransition("This partner has no hub yet.");
    }
    return { partner, vendorId, warehouseId: warehouse.id };
  }

  async list(principal: AuthPrincipal, partnerId?: string): Promise<MysteryOrderView[]> {
    const rows = await this.prisma.mysteryOrder.findMany({
      where: { partner: adminPartnerScope(principal), ...(partnerId ? { partnerId } : {}) },
      include: MYSTERY_INCLUDE,
      orderBy: { createdAt: "desc" },
      take: 100,
    });
    return rows.map(toView);
  }

  async assess(principal: AuthPrincipal, orderId: string, passed: boolean, note: string, meta: RequestMeta): Promise<MysteryOrderView> {
    const existing = await this.prisma.mysteryOrder.findFirst({ where: { orderId, partner: adminPartnerScope(principal) }, include: MYSTERY_INCLUDE });
    if (!existing) {
      throw Errors.notFound();
    }
    if (existing.createdBy === principal.userId) {
      throw Errors.secondPersonRequired("Someone other than the person who placed the test order records the result.");
    }
    if (!(SHIPPED_ORDER_STATUSES as readonly string[]).includes(existing.order.status)) {
      throw Errors.invalidTransition("Assess the test order once it has been handed to the carrier.");
    }
    const updated = await this.prisma.mysteryOrder.updateMany({
      where: { orderId, outcome: "PENDING" },
      data: { outcome: passed ? "PASSED" : "FAILED", outcomeNote: note, assessedBy: principal.userId, assessedAt: new Date() },
    });
    if (updated.count === 0) {
      throw Errors.invalidTransition("This test order has already been assessed.");
    }
    await this.audit.record({ actor: actorOf(principal), action: passed ? "partner.mystery_passed" : "partner.mystery_failed", resourceType: "order", resourceId: orderId, after: { note }, meta });
    return toView(await this.prisma.mysteryOrder.findUniqueOrThrow({ where: { orderId }, include: MYSTERY_INCLUDE }));
  }
}
