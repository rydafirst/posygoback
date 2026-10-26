import { randomUUID } from "node:crypto";

import { Injectable } from "@nestjs/common";

import type { AuthPrincipal } from "../../../common/auth/auth-principal";
import { Errors } from "../../../common/http/app-exception";
import { PrismaService } from "../../../database/prisma.service";
import type { Prisma } from "../../../generated/prisma/client";
import type { StorefrontOrderStatus, StorefrontOrderView } from "../../../shared";
import { reviewerCountryScope, vendorIdOf } from "../../onboarding/scope";
import { type OrderAudience, STOREFRONT_ORDER_INCLUDE, StorefrontRepository } from "../storefront.repository";
import { DiscountsService } from "../checkout/discounts.service";
import { StorefrontRefundsService } from "./storefront-refunds.service";

const PAGE = 100;

@Injectable()
export class StorefrontOrdersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly repository: StorefrontRepository,
    private readonly refunds: StorefrontRefundsService,
    private readonly discounts: DiscountsService,
  ) {}

  listForVendor(principal: AuthPrincipal, status?: StorefrontOrderStatus): Promise<StorefrontOrderView[]> {
    return this.list({ vendorId: vendorIdOf(principal), status: status ?? { not: "PENDING_PAYMENT" } }, "VENDOR");
  }

  vendorDetail(principal: AuthPrincipal, orderId: string): Promise<StorefrontOrderView> {
    return this.detail({ id: orderId, vendorId: vendorIdOf(principal), status: { not: "PENDING_PAYMENT" } }, "VENDOR");
  }

  listForStaff(principal: AuthPrincipal, status?: StorefrontOrderStatus): Promise<StorefrontOrderView[]> {
    const country = reviewerCountryScope(principal);
    return this.list({ ...(country ? { countryCode: country } : {}), ...(status ? { status } : {}) }, "STAFF");
  }

  staffDetail(principal: AuthPrincipal, orderId: string): Promise<StorefrontOrderView> {
    const country = reviewerCountryScope(principal);
    return this.detail({ id: orderId, ...(country ? { countryCode: country } : {}) }, "STAFF");
  }

  listForBuyer(buyerId: string): Promise<StorefrontOrderView[]> {
    return this.list({ buyerId, paidAt: { not: null } }, "BUYER");
  }

  buyerDetail(buyerId: string, orderId: string): Promise<StorefrontOrderView> {
    return this.detail({ id: orderId, buyerId, paidAt: { not: null } }, "BUYER");
  }

  async refund(principal: AuthPrincipal, orderId: string, amountMinor: number, note: string): Promise<StorefrontOrderView> {
    await this.staffDetail(principal, orderId);
    await this.refunds.refund(orderId, amountMinor, `staff:${randomUUID()}`, { userId: principal.userId, role: principal.role }, note);
    return this.staffDetail(principal, orderId);
  }

  async expireUnpaid(now: Date = new Date()): Promise<number> {
    const due = await this.prisma.storefrontOrder.findMany({ where: { status: "PENDING_PAYMENT", expiresAt: { lt: now } }, select: { id: true, discountCodeId: true }, take: 500 });
    let expired = 0;
    for (const order of due) {
      expired += await this.prisma.$transaction(async (tx) => {
        const closed = await tx.storefrontOrder.updateMany({ where: { id: order.id, status: "PENDING_PAYMENT" }, data: { status: "CANCELLED" } });
        if (closed.count > 0 && order.discountCodeId) {
          await this.discounts.release(tx, order.discountCodeId);
        }
        return closed.count;
      });
    }
    return expired;
  }

  private async list(where: Prisma.StorefrontOrderWhereInput, audience: OrderAudience): Promise<StorefrontOrderView[]> {
    const rows = await this.prisma.storefrontOrder.findMany({ where, include: STOREFRONT_ORDER_INCLUDE, orderBy: { createdAt: "desc" }, take: PAGE });
    return rows.map((row) => this.repository.view(row, audience));
  }

  private async detail(where: Prisma.StorefrontOrderWhereInput, audience: OrderAudience): Promise<StorefrontOrderView> {
    const row = await this.prisma.storefrontOrder.findFirst({ where, include: STOREFRONT_ORDER_INCLUDE });
    if (!row) {
      throw Errors.notFound();
    }
    return this.repository.view(row, audience);
  }
}
