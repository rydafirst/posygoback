import { Injectable } from "@nestjs/common";

import type { AuthPrincipal, RequestMeta } from "../../../common/auth/auth-principal";
import { Errors } from "../../../common/http/app-exception";
import { lockRow, PrismaService } from "../../../database/prisma.service";
import type { FulfilmentPartner, Prisma } from "../../../generated/prisma/client";
import { AuditService } from "../../../infrastructure/audit/audit.service";
import {
  CLOSED_PARTNER_STATUSES,
  DECISION_TARGET,
  decisionsFrom,
  hasPermission,
  MANAGER_DECISIONS,
  OPEN_ORDER_STATUSES,
  type PartnerDecision,
  type PartnerDetailView,
  partnerProgramme,
  partnerRates,
  REVIEWED_CHECKS,
  type PartnerStatus,
  type PartnerSummaryView,
} from "../../../shared";
import { SessionService } from "../../auth/sessions/session.service";
import { reviewerCountryScope } from "../../onboarding/scope";
import { StaffService } from "../../staff/staff.service";
import { PartnerEmails } from "../partner-emails";
import { PartnerNotifierService } from "../partner-notifier.service";
import { PartnerReadinessService } from "../partner-readiness.service";
import { PartnersRepository, type StoredProfile, toPartnerSummary } from "../partners.repository";
import { StockCountFactoryService } from "../trust/stock-count-factory.service";

const AUDIT_COUNT_DUE_HOURS = 72;

export function adminPartnerScope(principal: AuthPrincipal): Prisma.FulfilmentPartnerWhereInput {
  const country = reviewerCountryScope(principal);
  return country ? { countryCode: country } : {};
}

export function actorOf(principal: AuthPrincipal) {
  return { userId: principal.userId, role: principal.role };
}

@Injectable()
export class AdminPartnersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly partners: PartnersRepository,
    private readonly readiness: PartnerReadinessService,
    private readonly staff: StaffService,
    private readonly sessions: SessionService,
    private readonly notifier: PartnerNotifierService,
    private readonly counts: StockCountFactoryService,
    private readonly audit: AuditService,
  ) {}

  async list(principal: AuthPrincipal, status?: PartnerStatus): Promise<PartnerSummaryView[]> {
    const rows = await this.partners.list({ ...adminPartnerScope(principal), ...(status ? { status } : {}) });
    return rows.map(toPartnerSummary);
  }

  async detail(principal: AuthPrincipal, partnerId: string): Promise<PartnerDetailView> {
    const row = await this.partners.detail(partnerId, adminPartnerScope(principal));
    return this.partners.view(row, await this.readiness.evaluate(partnerId));
  }

  async scoped(principal: AuthPrincipal, partnerId: string): Promise<FulfilmentPartner> {
    const partner = await this.prisma.fulfilmentPartner.findFirst({ where: { id: partnerId, ...adminPartnerScope(principal) } });
    if (!partner) {
      throw Errors.notFound();
    }
    return partner;
  }

  async inviteLead(principal: AuthPrincipal, partnerId: string, email: string, meta: RequestMeta): Promise<void> {
    const partner = await this.scoped(principal, partnerId);
    if (CLOSED_PARTNER_STATUSES.includes(partner.status)) {
      throw Errors.invalidTransition("This partnership is closed.");
    }
    await this.staff.issueInvitation(principal, { email, role: "FULFILMENT_PARTNER", countryCode: partner.countryCode, partnerId }, meta);
  }

  async setRequirements(principal: AuthPrincipal, partnerId: string, input: { requiredDepositMinor: number; requiredInsuranceMinor: number }, meta: RequestMeta): Promise<PartnerDetailView> {
    const partner = await this.scoped(principal, partnerId);
    if (partner.status === "ACTIVE" || CLOSED_PARTNER_STATUSES.includes(partner.status)) {
      throw Errors.invalidTransition("Requirements can only change while the partner isn't operating.");
    }
    await this.prisma.$transaction(async (tx) => {
      await tx.fulfilmentPartner.update({ where: { id: partnerId }, data: { requiredDepositMinor: BigInt(input.requiredDepositMinor), requiredInsuranceMinor: BigInt(input.requiredInsuranceMinor) } });
      await this.audit.record(
        {
          actor: actorOf(principal),
          action: "partner.requirements_changed",
          resourceType: "fulfilment_partner",
          resourceId: partnerId,
          countryCode: partner.countryCode,
          before: { requiredDepositMinor: Number(partner.requiredDepositMinor), requiredInsuranceMinor: Number(partner.requiredInsuranceMinor) },
          after: input,
          meta,
        },
        tx,
      );
    });
    return this.detail(principal, partnerId);
  }

  async setTier(principal: AuthPrincipal, partnerId: string, level: number, reason: string, meta: RequestMeta): Promise<PartnerDetailView> {
    const partner = await this.scoped(principal, partnerId);
    const country = await this.prisma.country.findUniqueOrThrow({ where: { code: partner.countryCode }, select: { config: true } });
    if (!partnerProgramme(country.config as { partners?: unknown }).tiers.some((tier) => tier.level === level)) {
      throw Errors.validation({ level: ["Choose one of this country's tiers"] });
    }
    await this.prisma.$transaction(async (tx) => {
      await lockRow(tx, "fulfilmentPartners", partnerId);
      await tx.fulfilmentPartner.update({ where: { id: partnerId }, data: { tierLevel: level, tierSetManuallyAt: new Date() } });
      await this.audit.record(
        {
          actor: actorOf(principal),
          action: "partner.tier_changed",
          resourceType: "fulfilment_partner",
          resourceId: partnerId,
          countryCode: partner.countryCode,
          before: { tierLevel: partner.tierLevel },
          after: { tierLevel: level, reason },
          meta,
        },
        tx,
      );
    });
    return this.detail(principal, partnerId);
  }

  async assignWarehouse(principal: AuthPrincipal, partnerId: string, warehouseId: string, meta: RequestMeta): Promise<PartnerDetailView> {
    const partner = await this.scoped(principal, partnerId);
    if (CLOSED_PARTNER_STATUSES.includes(partner.status) || partner.status === "OFFBOARDING") {
      throw Errors.invalidTransition("Hubs can't be assigned to a partnership that is closing.");
    }
    await this.prisma.$transaction(async (tx) => {
      await lockRow(tx, "fulfilmentPartners", partnerId);
      const warehouse = await tx.warehouse.findFirst({ where: { id: warehouseId, countryCode: partner.countryCode }, include: { partner: { select: { status: true } } } });
      if (!warehouse) {
        throw Errors.notFound("Hub not found in this country.");
      }
      if (warehouse.partnerId === partnerId) {
        return;
      }
      if (warehouse.partner && !CLOSED_PARTNER_STATUSES.includes(warehouse.partner.status)) {
        throw Errors.invalidTransition("Another partner runs this hub.");
      }
      const stock = await tx.stockLot.count({ where: { warehouseId, OR: [{ quantityAvailable: { gt: 0 } }, { quantityReserved: { gt: 0 } }] } });
      if (stock > 0) {
        throw Errors.invalidTransition("Move the stock out of this hub before handing it to a partner.");
      }
      await tx.warehouse.update({ where: { id: warehouseId }, data: { partnerId } });
      await this.audit.record(
        {
          actor: actorOf(principal),
          action: "partner.warehouse_assigned",
          resourceType: "warehouse",
          resourceId: warehouseId,
          countryCode: partner.countryCode,
          before: { partnerId: warehouse.partnerId },
          after: { partnerId },
          meta,
        },
        tx,
      );
    });
    return this.detail(principal, partnerId);
  }

  async decide(principal: AuthPrincipal, partnerId: string, decision: PartnerDecision, reason: string, meta: RequestMeta): Promise<PartnerDetailView> {
    if (MANAGER_DECISIONS.includes(decision) && !hasPermission(principal.role, "partners.manage")) {
      throw Errors.forbidden("Only partner managers can make this decision.");
    }
    await this.scoped(principal, partnerId);
    const target = DECISION_TARGET[decision];
    const partner = await this.prisma.$transaction(async (tx) => {
      await lockRow(tx, "fulfilmentPartners", partnerId);
      const current = await tx.fulfilmentPartner.findUniqueOrThrow({ where: { id: partnerId } });
      if (!decisionsFrom(current.status).includes(decision)) {
        throw Errors.invalidTransition("That decision isn't available for this partner right now.");
      }
      await this.assertDecisionAllowed(tx, current, decision);
      if (decision === "APPROVE") {
        await this.approve(tx, current, principal);
      }
      await this.transition(tx, current, target, reason);
      await this.audit.record(
        {
          actor: actorOf(principal),
          action: `partner.${decision.toLowerCase()}`,
          resourceType: "fulfilment_partner",
          resourceId: partnerId,
          countryCode: current.countryCode,
          before: { status: current.status },
          after: { status: target, reason },
          meta,
        },
        tx,
      );
      return current;
    });
    await this.notifier.notify(partnerId, (to, webUrl) => PartnerEmails.decided(to, partner.legalName, decision, reason, webUrl));
    if (target === "SUSPENDED" || target === "OFFBOARDING") {
      await this.counts.requestIfStocked({
        partnerId,
        countryCode: partner.countryCode,
        lines: "ALL",
        dueInHours: AUDIT_COUNT_DUE_HOURS,
        note: target === "SUSPENDED" ? "Full count while the hub is paused" : "Full count before we collect the stock",
        actor: actorOf(principal),
        reason: decision.toLowerCase(),
        meta,
      });
    }
    return this.detail(principal, partnerId);
  }

  async transition(tx: Prisma.TransactionClient, partner: FulfilmentPartner, target: PartnerStatus, reason: string): Promise<void> {
    await tx.fulfilmentPartner.update({
      where: { id: partner.id },
      data: { status: target, statusReason: reason, activatedAt: target === "ACTIVE" && !partner.activatedAt ? new Date() : undefined, terminatedAt: target === "TERMINATED" ? new Date() : undefined },
    });
    if (CLOSED_PARTNER_STATUSES.includes(target)) {
      await this.closeAccess(tx, partner.id);
    }
  }

  private async approve(tx: Prisma.TransactionClient, partner: FulfilmentPartner, principal: AuthPrincipal): Promise<void> {
    const reviewed = await tx.partnerCheck.count({ where: { partnerId: partner.id, kind: { in: [...REVIEWED_CHECKS] }, reviewedBy: principal.userId } });
    if (reviewed > 0) {
      throw Errors.forbidden("Someone who didn't review the verification steps approves the partner.");
    }
    const schedule = await tx.feeSchedule.findFirst({ where: { countryCode: partner.countryCode, status: "ACTIVE" }, select: { schedule: true } });
    const rates = partnerRates((schedule?.schedule ?? {}) as { partner?: unknown });
    const founders = await tx.fulfilmentPartner.count({ where: { countryCode: partner.countryCode, founding: true } });
    await tx.fulfilmentPartner.update({ where: { id: partner.id }, data: { tierLevel: 1, founding: founders < rates.foundingPlaces, approvedBy: principal.userId } });
    if ((await tx.warehouse.count({ where: { partnerId: partner.id } })) > 0) {
      return;
    }
    const profile = partner.profile as StoredProfile | null;
    if (!profile) {
      throw Errors.invalidTransition("The partner has no storage address on file.");
    }
    await tx.warehouse.create({
      data: {
        countryCode: partner.countryCode,
        code: `HUB-${partner.reference.slice(-6)}`,
        name: `${profile.city} hub`.slice(0, 80),
        addressLines: profile.addressLines,
        city: profile.city,
        postalCode: profile.postalCode,
        partnerId: partner.id,
      },
    });
  }

  private async assertDecisionAllowed(tx: Prisma.TransactionClient, partner: FulfilmentPartner, decision: PartnerDecision): Promise<void> {
    if (decision === "APPROVE" || decision === "REINSTATE") {
      const readiness = await this.readiness.evaluate(partner.id, tx);
      if (!PartnerReadinessService.ready(readiness)) {
        throw Errors.invalidTransition(`Still needed: ${PartnerReadinessService.missing(readiness).join(", ")}.`);
      }
    }
    if (decision === "TERMINATE") {
      const stock = await tx.stockLot.count({ where: { warehouse: { partnerId: partner.id }, OR: [{ quantityAvailable: { gt: 0 } }, { quantityReserved: { gt: 0 } }] } });
      const orders = await tx.order.count({ where: { warehouse: { partnerId: partner.id }, status: { in: [...OPEN_ORDER_STATUSES] } } });
      if (stock > 0 || orders > 0) {
        throw Errors.invalidTransition("Move all stock and finish open orders in this partner's hub before terminating.");
      }
    }
  }

  private async closeAccess(tx: Prisma.TransactionClient, partnerId: string): Promise<void> {
    const users = await tx.user.findMany({ where: { partnerId }, select: { id: true } });
    await tx.user.updateMany({ where: { partnerId }, data: { status: "SUSPENDED" } });
    await tx.staffInvitation.updateMany({ where: { partnerId, status: "PENDING" }, data: { status: "REVOKED", revokedAt: new Date() } });
    for (const user of users) {
      await this.sessions.revokeAllForUser(user.id, "partner_closed", tx);
    }
  }
}
