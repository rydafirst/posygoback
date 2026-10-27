import { Injectable } from "@nestjs/common";

import type { AuthPrincipal, RequestMeta } from "../../../common/auth/auth-principal";
import { Errors } from "../../../common/http/app-exception";
import { type DatabaseClient, PrismaService } from "../../../database/prisma.service";
import { AuditService } from "../../../infrastructure/audit/audit.service";
import { type CustodyAlertKind, type CustodyAlertView, partnerProgramme } from "../../../shared";
import { StaffAlertsService } from "../../notifications/staff-alerts.service";
import { reviewerCountryScope } from "../../onboarding/scope";
import { actorOf } from "../admin/admin-partners.service";
import { ALERT_INCLUDE, type AlertRow, toAlertView } from "./custody.repository";

const HOUR_MS = 60 * 60 * 1000;

const ALERT_TITLES: Record<CustodyAlertKind, string> = {
  NO_CARRIER_SCAN: "Parcel not scanned by the carrier",
  COUNT_SHORTFALL: "Stock count didn't match",
  SHRINKAGE: "Too much stock lost",
  TRUST_LOW: "Hub paused for a low trust score",
};

export interface NewAlert {
  kind: CustodyAlertKind;
  countryCode: string;
  partnerId: string | null;
  warehouseId: string | null;
  subjectType: string;
  subjectId: string;
  message: string;
}

@Injectable()
export class CustodyAlertsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly staffAlerts: StaffAlertsService,
  ) {}

  async raise(alerts: readonly NewAlert[]): Promise<number> {
    const opened = await this.open(alerts, this.prisma);
    await this.announce(opened);
    return opened.length;
  }

  async open(alerts: readonly NewAlert[], client: DatabaseClient): Promise<AlertRow[]> {
    if (alerts.length === 0) {
      return [];
    }
    return client.custodyAlert.createManyAndReturn({ data: alerts.map((alert) => ({ ...alert, message: alert.message.slice(0, 500) })), skipDuplicates: true, include: ALERT_INCLUDE });
  }

  async announce(opened: readonly AlertRow[]): Promise<void> {
    for (const alert of opened) {
      const hub = alert.warehouse?.name ?? alert.partner?.legalName;
      await this.staffAlerts.raise("alerts", { countryCode: alert.countryCode, title: hub ? `${ALERT_TITLES[alert.kind]} at ${hub}` : ALERT_TITLES[alert.kind], body: alert.message });
    }
  }

  async list(principal: AuthPrincipal, status: "OPEN" | "RESOLVED" = "OPEN"): Promise<CustodyAlertView[]> {
    const country = reviewerCountryScope(principal);
    const rows = await this.prisma.custodyAlert.findMany({ where: { status, ...(country ? { countryCode: country } : {}) }, include: ALERT_INCLUDE, orderBy: { createdAt: "desc" }, take: 200 });
    return rows.map(toAlertView);
  }

  async resolve(principal: AuthPrincipal, alertId: string, note: string, meta: RequestMeta): Promise<CustodyAlertView> {
    const country = reviewerCountryScope(principal);
    const alert = await this.prisma.custodyAlert.findFirst({ where: { id: alertId, ...(country ? { countryCode: country } : {}) }, select: { id: true, countryCode: true } });
    if (!alert) {
      throw Errors.notFound();
    }
    const resolved = await this.prisma.custodyAlert.updateMany({
      where: { id: alertId, status: "OPEN" },
      data: { status: "RESOLVED", resolvedBy: principal.userId, resolvedAt: new Date(), resolutionNote: note },
    });
    if (resolved.count === 0) {
      throw Errors.invalidTransition("This alert has already been resolved.");
    }
    await this.audit.record({ actor: actorOf(principal), action: "custody.alert_resolved", resourceType: "custody_alert", resourceId: alertId, countryCode: alert.countryCode, after: { note }, meta });
    const row = await this.prisma.custodyAlert.findUniqueOrThrow({ where: { id: alertId }, include: ALERT_INCLUDE });
    return toAlertView(row);
  }

  async scanMissingCarrierScans(now: Date = new Date()): Promise<number> {
    const countries = await this.prisma.country.findMany({ select: { code: true, config: true } });
    let raised = 0;
    for (const country of countries) {
      const hours = partnerProgramme(country.config as { partners?: unknown }).noScanAlertHours;
      const stale = await this.prisma.order.findMany({
        where: { originCountryCode: country.code, status: "HANDED_OFF", handedOffAt: { lt: new Date(now.getTime() - hours * HOUR_MS) } },
        select: { id: true, reference: true, carrier: true, warehouseId: true, warehouse: { select: { partnerId: true } } },
        take: 1000,
      });
      raised += await this.raise(
        stale.map((order) => ({
          kind: "NO_CARRIER_SCAN" as const,
          countryCode: country.code,
          partnerId: order.warehouse.partnerId,
          warehouseId: order.warehouseId,
          subjectType: "order",
          subjectId: order.id,
          message: `Order ${order.reference} was handed to ${order.carrier ?? "the carrier"} over ${hours} hours ago and hasn't been scanned since.`,
        })),
      );
    }
    return raised;
  }
}
