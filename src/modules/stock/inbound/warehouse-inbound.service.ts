import { Injectable } from "@nestjs/common";
import {
  canApplyInboundAction,
  hasPermission,
  type InboundAction,
  type InboundDetailView,
  type InboundStatus,
  type InboundSummaryView,
  OPEN_INBOUND_STATUSES,
  Money,
  type ReceiveInboundInput,
} from "../../../shared";

import type { AuthPrincipal, RequestMeta } from "../../../common/auth/auth-principal";
import { Errors } from "../../../common/http/app-exception";
import { lockRow, PrismaService } from "../../../database/prisma.service";
import { AuditService } from "../../../infrastructure/audit/audit.service";
import { FilesService } from "../../files/files.service";
import { warehouseScope } from "../scope";
import { StockEmails } from "../stock-emails";
import { WarehouseAccessService } from "../warehouses/warehouse-access.service";
import { InboundRepository, type InboundRow } from "./inbound.repository";
import { InboundAlertsService } from "./inbound-alerts.service";
import { ReceivingService } from "./receiving.service";

export type OperatorAction = Exclude<InboundAction, "SUBMIT" | "CANCEL" | "PAY_HOLD" | "COMPLETE">;

const OPERATOR_ACTIONS: readonly InboundAction[] = ["CHECK_IN", "HOLD", "RELEASE", "COMPLETE", "REJECT", "REQUEST_RETURN"];
const PLATFORM_ONLY: readonly InboundAction[] = ["REJECT", "REQUEST_RETURN"];

const OUTCOME: Record<OperatorAction, { status: InboundStatus; needsReason: boolean }> = {
  CHECK_IN: { status: "ARRIVED", needsReason: false },
  HOLD: { status: "ON_HOLD", needsReason: true },
  RELEASE: { status: "ARRIVED", needsReason: false },
  REJECT: { status: "REJECTED", needsReason: true },
  REQUEST_RETURN: { status: "RETURN_REQUESTED", needsReason: true },
};

@Injectable()
export class WarehouseInboundService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly inbound: InboundRepository,
    private readonly warehouses: WarehouseAccessService,
    private readonly receiving: ReceivingService,
    private readonly files: FilesService,
    private readonly audit: AuditService,
    private readonly owners: InboundAlertsService,
  ) {}

  queue(principal: AuthPrincipal, status?: InboundStatus): Promise<InboundSummaryView[]> {
    const statuses = status ? (status === "DRAFT" ? [] : [status]) : OPEN_INBOUND_STATUSES;
    if (statuses.length === 0) {
      return Promise.resolve([]);
    }
    return this.inbound.summaries({ warehouse: warehouseScope(principal), statuses });
  }

  async detail(principal: AuthPrincipal, inboundId: string): Promise<InboundDetailView> {
    await this.visible(principal, inboundId);
    const detail = await this.inbound.detail(inboundId);
    const allowed = principal.partnerId ? OPERATOR_ACTIONS.filter((action) => !PLATFORM_ONLY.includes(action)) : OPERATOR_ACTIONS;
    const actions = hasPermission(principal.role, "inbound.receive") ? allowed.filter((action) => canApplyInboundAction(action, detail.status)) : [];
    return principal.partnerId ? { ...detail, actions, charges: { ...detail.charges, onboardingFeeMinor: null, onboardingChargedAt: null, holdChargeMinor: null } } : { ...detail, actions };
  }

  async apply(principal: AuthPrincipal, inboundId: string, action: OperatorAction, reason: string | undefined, chargeMinor: number | undefined, meta: RequestMeta): Promise<InboundDetailView> {
    const outcome = OUTCOME[action];
    if (outcome.needsReason && !reason) {
      throw Errors.validation({ reason: ["Explain why, in at least 10 characters"] });
    }
    if (chargeMinor !== undefined && action !== "HOLD") {
      throw Errors.validation({ chargeMinor: ["Only a hold can carry a charge"] });
    }
    if (principal.partnerId && (chargeMinor !== undefined || PLATFORM_ONLY.includes(action))) {
      throw Errors.forbidden("Put the shipment on hold and explain why. Our operations team decides on charges, refusals and returns.");
    }
    const { updated, chargeWaived } = await this.prisma.$transaction(async (tx) => {
      const existing = (await lockRow(tx, "inboundShipments", inboundId)) ? await tx.inboundShipment.findUnique({ where: { id: inboundId } }) : null;
      if (!existing) {
        throw Errors.notFound();
      }
      await this.warehouses.inScope(principal, existing.warehouseId, tx);
      if (!canApplyInboundAction(action, existing.status)) {
        throw Errors.invalidTransition("This shipment can't be changed that way right now.");
      }
      const status = action === "RELEASE" ? (existing.statusBeforeHold ?? "ARRIVED") : outcome.status;
      const waived = action === "RELEASE" && existing.holdChargeMinor !== null && !existing.holdPaidAt;
      const row = await tx.inboundShipment.update({
        where: { id: existing.id },
        data: {
          status,
          statusReason: outcome.needsReason ? reason : action === "RELEASE" ? null : existing.statusReason,
          arrivedAt: action === "CHECK_IN" ? new Date() : existing.arrivedAt,
          ...(action === "HOLD" ? { statusBeforeHold: existing.status, holdChargeMinor: chargeMinor === undefined ? null : BigInt(chargeMinor), holdPlacedAt: new Date(), holdPaidAt: null } : {}),
          ...(action === "RELEASE" ? { statusBeforeHold: null } : {}),
        },
      });
      await this.audit.record(
        {
          actor: { userId: principal.userId, role: principal.role },
          action: `inbound.${action.toLowerCase()}`,
          resourceType: "inbound_shipment",
          resourceId: existing.id,
          vendorId: existing.vendorId,
          countryCode: existing.countryCode,
          before: { status: existing.status },
          after: { status, reason: reason ?? null, chargeMinor: chargeMinor ?? null, waived },
          meta,
        },
        tx,
      );
      return { updated: row, chargeWaived: waived };
    });
    await this.tellOwner(updated, action, reason ?? "", chargeMinor ? await this.chargeNotice(updated.countryCode, chargeMinor) : null, chargeWaived);
    return this.detail(principal, inboundId);
  }

  async receive(principal: AuthPrincipal, inboundId: string, input: ReceiveInboundInput, meta: RequestMeta): Promise<InboundDetailView> {
    const { inbound, matched } = await this.receiving.receive(principal, inboundId, input, meta);
    await this.owners.tellOwner(inbound, (to, webUrl) => (matched ? StockEmails.received(to, inbound, webUrl) : StockEmails.discrepancy(to, inbound, webUrl)));
    return this.detail(principal, inboundId);
  }

  async postMessage(principal: AuthPrincipal, inboundId: string, body: string, meta: RequestMeta): Promise<InboundDetailView> {
    const existing = await this.visible(principal, inboundId);
    await this.prisma.$transaction(async (tx) => {
      await tx.inboundMessage.create({ data: { inboundId: existing.id, authorUserId: principal.userId, fromPlatform: true, body } });
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
    await this.owners.tellOwner(existing, (to, webUrl) => StockEmails.newMessage(to, existing, webUrl));
    return this.detail(principal, inboundId);
  }

  async photoUrl(principal: AuthPrincipal, inboundId: string, fileId: string, meta: RequestMeta) {
    await this.visible(principal, inboundId);
    if (!(await this.inbound.hasPhoto(inboundId, fileId))) {
      throw Errors.notFound();
    }
    return this.files.linkedDownloadUrl(fileId, "EVIDENCE_PHOTO", principal, meta);
  }

  private async visible(principal: AuthPrincipal, inboundId: string): Promise<InboundRow> {
    const existing = await this.inbound.find(inboundId);
    if (!existing || existing.status === "DRAFT") {
      throw Errors.notFound();
    }
    await this.warehouses.inScope(principal, existing.warehouseId);
    return existing;
  }

  private async chargeNotice(countryCode: string, chargeMinor: number): Promise<string> {
    const country = await this.prisma.country.findUniqueOrThrow({ where: { code: countryCode }, select: { currency: true } });
    return `A charge of ${Money.of(chargeMinor, country.currency).format("en-GB")} is due before we can continue. Pay it from the shipment page.`;
  }

  private tellOwner(inbound: InboundRow, action: OperatorAction, reason: string, chargeNotice: string | null, chargeWaived: boolean): Promise<void> {
    switch (action) {
      case "CHECK_IN":
        return this.owners.tellOwner(inbound, (to, webUrl) => StockEmails.arrived(to, inbound, webUrl));
      case "HOLD":
        return this.owners.tellOwner(inbound, (to, webUrl) => StockEmails.onHold(to, inbound, reason, chargeNotice, webUrl));
      case "RELEASE":
        return this.owners.tellOwner(inbound, (to, webUrl) => StockEmails.released(to, inbound, chargeWaived, webUrl));
      case "REJECT":
        return this.owners.tellOwner(inbound, (to, webUrl) => StockEmails.refused(to, inbound, reason, webUrl));
      case "REQUEST_RETURN":
        return this.owners.tellOwner(inbound, (to, webUrl) => StockEmails.returnRequested(to, inbound, reason, webUrl));
    }
  }
}
