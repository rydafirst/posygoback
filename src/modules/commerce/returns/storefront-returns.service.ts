import { Inject, Injectable } from "@nestjs/common";

import type { AuthPrincipal, RequestMeta } from "../../../common/auth/auth-principal";
import { Errors } from "../../../common/http/app-exception";
import { lockRow, PrismaService } from "../../../database/prisma.service";
import type { Prisma } from "../../../generated/prisma/client";
import { type AuditActor, AuditService } from "../../../infrastructure/audit/audit.service";
import { EMAIL_SENDER, type EmailSender } from "../../../infrastructure/email/email.port";
import type { ReturnDecisionInput, StoreReturnCaseView, StorefrontOrderView, StorefrontReturnStatus } from "../../../shared";
import { WalletAlertsService } from "../../finance/wallets/wallet-alerts.service";
import { reviewerCountryScope, vendorIdOf } from "../../onboarding/scope";
import { randomCode } from "../../stock/inbound/references";
import { CommerceEmails } from "../commerce-emails";
import { StorefrontOrdersService } from "../orders/storefront-orders.service";
import { StorefrontRefundsService } from "../orders/storefront-refunds.service";
import { returnBlocker, returnView, STOREFRONT_ORDER_INCLUDE, StorefrontRepository } from "../storefront.repository";

const PAGE = 100;
const RETURN_INCLUDE = { order: { include: STOREFRONT_ORDER_INCLUDE } } satisfies Prisma.StorefrontReturnInclude;

export function refundLimit(order: { totalMinor: bigint; refundedMinor: bigint; vendorShareMinor: bigint }, audience: "VENDOR" | "STAFF"): number {
  const ceiling = audience === "VENDOR" ? Number(order.vendorShareMinor) : Number(order.totalMinor);
  return Math.max(0, ceiling - Number(order.refundedMinor));
}

@Injectable()
export class StorefrontReturnsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly repository: StorefrontRepository,
    private readonly orders: StorefrontOrdersService,
    private readonly refunds: StorefrontRefundsService,
    private readonly owners: WalletAlertsService,
    private readonly audit: AuditService,
    @Inject(EMAIL_SENDER) private readonly email: EmailSender,
  ) {}

  async request(buyerId: string, orderId: string, reason: string, meta: RequestMeta): Promise<StorefrontOrderView> {
    const order = await this.prisma.$transaction(async (tx) => {
      await lockRow(tx, "storefrontOrders", orderId);
      const row = await tx.storefrontOrder.findFirst({ where: { id: orderId, buyerId, paidAt: { not: null } }, include: STOREFRONT_ORDER_INCLUDE });
      if (!row) {
        throw Errors.notFound();
      }
      const blocker = returnBlocker(row);
      if (blocker) {
        throw Errors.invalidTransition(blocker);
      }
      const created = await tx.storefrontReturn.create({ data: { reference: `RT-${row.countryCode}-${randomCode(8)}`, storefrontOrderId: row.id, reason } });
      await this.audit.record(
        {
          actor: { userId: null, role: null },
          action: "storefront.return_requested",
          resourceType: "storefront_return",
          resourceId: created.id,
          vendorId: row.vendorId,
          countryCode: row.countryCode,
          after: { buyerId },
          meta,
        },
        tx,
      );
      return row;
    });
    await this.owners.notifyOwner(order.vendorId, (to) => CommerceEmails.returnRequested(to, order.reference), "/storefront").catch(() => undefined);
    return this.orders.buyerDetail(buyerId, orderId);
  }

  listForVendor(principal: AuthPrincipal, status?: StorefrontReturnStatus): Promise<StoreReturnCaseView[]> {
    return this.list({ order: { vendorId: vendorIdOf(principal) }, ...(status ? { status } : {}) }, "VENDOR");
  }

  listForStaff(principal: AuthPrincipal, status?: StorefrontReturnStatus): Promise<StoreReturnCaseView[]> {
    const country = reviewerCountryScope(principal);
    return this.list({ ...(country ? { order: { countryCode: country } } : {}), ...(status ? { status } : {}) }, "STAFF");
  }

  async decide(principal: AuthPrincipal, returnId: string, input: ReturnDecisionInput, meta: RequestMeta): Promise<StoreReturnCaseView> {
    const audience = principal.vendorId ? "VENDOR" : "STAFF";
    const existing = await this.find(principal, returnId);
    const decision = await this.prisma.$transaction(async (tx) => {
      await lockRow(tx, "storefrontOrders", existing.storefrontOrderId);
      const current = await tx.storefrontReturn.findUniqueOrThrow({ where: { id: returnId }, include: RETURN_INCLUDE });
      if (current.status !== "REQUESTED") {
        throw Errors.invalidTransition("This return has already been decided.");
      }
      const refundable = refundLimit(current.order, audience);
      if (input.accept && (input.refundMinor ?? 0) > refundable) {
        throw Errors.validation({ refundMinor: [audience === "VENDOR" ? "That's more than your share of this order" : "That's more than is left to refund on this order"] });
      }
      const status = input.accept ? "APPROVED" : "REJECTED";
      await tx.storefrontReturn.update({
        where: { id: returnId },
        data: { status, decidedBy: principal.userId, decidedAt: new Date(), decisionNote: input.note, refundMinor: input.accept ? BigInt(input.refundMinor!) : null },
      });
      await this.audit.record(
        {
          actor: this.actor(principal),
          action: input.accept ? "storefront.return_accepted" : "storefront.return_rejected",
          resourceType: "storefront_return",
          resourceId: returnId,
          vendorId: current.order.vendorId,
          countryCode: current.order.countryCode,
          after: { refundMinor: input.refundMinor ?? null, note: input.note },
          meta,
        },
        tx,
      );
      return current;
    });
    const store = decision.order.vendor.storefront?.displayName ?? decision.order.vendor.businessName;
    await this.email.send(CommerceEmails.returnDecided(decision.order.buyerEmail, store, decision.order.reference, input.accept, input.note)).catch(() => undefined);
    if (input.accept) {
      await this.settle(returnId, this.actor(principal));
    }
    return this.caseView(returnId, audience);
  }

  async retryRefund(principal: AuthPrincipal, returnId: string): Promise<StoreReturnCaseView> {
    const existing = await this.find(principal, returnId);
    if (existing.status !== "APPROVED") {
      throw Errors.invalidTransition("Only accepted returns waiting for their refund can be retried.");
    }
    await this.settle(returnId, this.actor(principal));
    return this.caseView(returnId, principal.vendorId ? "VENDOR" : "STAFF");
  }

  private async settle(returnId: string, actor: AuditActor): Promise<void> {
    const entry = await this.prisma.storefrontReturn.findUniqueOrThrow({ where: { id: returnId } });
    const { refundId } = await this.refunds.refund(entry.storefrontOrderId, Number(entry.refundMinor), `return:${entry.id}`, actor, entry.decisionNote ?? "Return accepted");
    await this.prisma.storefrontReturn.updateMany({ where: { id: returnId, status: "APPROVED" }, data: { status: "REFUNDED", providerRefundId: refundId } });
  }

  private async find(principal: AuthPrincipal, returnId: string) {
    const country = reviewerCountryScope(principal);
    const entry = await this.prisma.storefrontReturn.findFirst({ where: { id: returnId, order: principal.vendorId ? { vendorId: principal.vendorId } : country ? { countryCode: country } : {} } });
    if (!entry) {
      throw Errors.notFound();
    }
    return entry;
  }

  private async caseView(returnId: string, audience: "VENDOR" | "STAFF"): Promise<StoreReturnCaseView> {
    const row = await this.prisma.storefrontReturn.findUniqueOrThrow({ where: { id: returnId }, include: RETURN_INCLUDE });
    return { ...returnView(row), order: this.repository.view(row.order, audience) };
  }

  private async list(where: Prisma.StorefrontReturnWhereInput, audience: "VENDOR" | "STAFF"): Promise<StoreReturnCaseView[]> {
    const rows = await this.prisma.storefrontReturn.findMany({ where, include: RETURN_INCLUDE, orderBy: { createdAt: "desc" }, take: PAGE });
    return rows.map((row) => ({ ...returnView(row), order: this.repository.view(row.order, audience) }));
  }

  private actor(principal: AuthPrincipal): AuditActor {
    return { userId: principal.userId, role: principal.role };
  }
}
