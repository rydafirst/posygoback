import { Injectable } from "@nestjs/common";

import type { AuthPrincipal, RequestMeta } from "../../../common/auth/auth-principal";
import { Errors } from "../../../common/http/app-exception";
import { type DatabaseClient, PrismaService } from "../../../database/prisma.service";
import type { Prisma } from "../../../generated/prisma/client";
import { AuditService } from "../../../infrastructure/audit/audit.service";
import { AttemptLimiterService } from "../../../infrastructure/rate-limit/attempt-limiter.service";
import type { ClaimKind, ClaimSource, ClaimStatus, ClaimView, ReportClaimInput } from "../../../shared";
import { WalletAlertsService } from "../../finance/wallets/wallet-alerts.service";
import { FilesService } from "../../files/files.service";
import { reviewerCountryScope, vendorIdOf } from "../../onboarding/scope";
import { randomCode } from "../../stock/inbound/references";
import { actorOf } from "../admin/admin-partners.service";
import { SHIPPED_ORDER_STATUSES } from "../ledger/partner-earnings.service";
import { CustodyEmails } from "./custody-emails";
import { CLAIM_INCLUDE, toClaimView } from "./custody.repository";

const REPORT_POLICY = { name: "claim-report", limit: 10, windowSeconds: 60 * 60 };
const LIVE_STATUSES: ClaimStatus[] = ["OPEN", "ASSESSED"];

export interface NewClaim {
  kind: ClaimKind;
  source: ClaimSource;
  vendorId: string;
  warehouseId: string;
  partnerId: string | null;
  countryCode: string;
  lotId: string | null;
  orderId: string | null;
  stockCountId?: string;
  transferId?: string;
  quantity: number;
  unitValueMinor: number;
  currency: string;
  description: string;
  evidenceFileIds?: string[];
  createdBy: string | null;
}

interface ClaimSubject {
  base: Omit<NewClaim, "kind" | "source" | "quantity" | "description" | "createdBy">;
  maxQuantity: number;
}

export interface ClaimFilters {
  status?: ClaimStatus;
  partnerId?: string;
}

function foundText(source: ClaimSource, quantity: number, product: string): string {
  const units = `${quantity} ${quantity === 1 ? "unit" : "units"} of ${product}`;
  return source === "TRANSFER" ? `While we were moving your stock between hubs, ${units} didn't arrive.` : `A stock count at one of our hubs came up ${units} short of what our records show.`;
}

export function claimReference(countryCode: string): string {
  return `CL-${countryCode}-${randomCode(6)}`;
}

@Injectable()
export class ClaimsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly files: FilesService,
    private readonly limiter: AttemptLimiterService,
    private readonly vendorAlerts: WalletAlertsService,
    private readonly audit: AuditService,
  ) {}

  async open(client: DatabaseClient, claim: NewClaim): Promise<string> {
    const { evidenceFileIds, unitValueMinor, ...rest } = claim;
    const created = await client.custodyClaim.create({
      data: {
        ...rest,
        reference: claimReference(claim.countryCode),
        unitValueMinor: BigInt(unitValueMinor),
        amountMinor: BigInt(unitValueMinor * claim.quantity),
        description: claim.description.slice(0, 1000),
        evidenceFileIds: evidenceFileIds ?? [],
      },
      select: { id: true },
    });
    return created.id;
  }

  async announceOpened(claimIds: readonly string[]): Promise<void> {
    const claims = await this.prisma.custodyClaim.findMany({
      where: { id: { in: [...claimIds] } },
      select: { reference: true, vendorId: true, source: true, quantity: true, lot: { select: { product: { select: { name: true } } } } },
    });
    for (const claim of claims) {
      const found = foundText(claim.source, claim.quantity, claim.lot?.product.name ?? "an item");
      await this.vendorAlerts.notifyOwner(claim.vendorId, (to, webUrl) => CustodyEmails.claimOpened(to, claim.reference, found, webUrl), "/claims").catch(() => undefined);
    }
  }

  async report(principal: AuthPrincipal, input: ReportClaimInput, meta: RequestMeta): Promise<ClaimView> {
    const vendorId = vendorIdOf(principal);
    await this.limiter.consume(REPORT_POLICY, vendorId);
    const statuses = await this.files.vendorFiles(vendorId, input.fileIds, "GENERAL_ATTACHMENT");
    if (input.fileIds.some((id) => statuses.get(id) !== "VERIFIED")) {
      throw Errors.validation({ fileIds: ["Wait for every photo to finish uploading"] });
    }
    const subject = await this.subject(input, { vendorId });
    return this.create(principal, subject, { ...input, source: "VENDOR_REPORT" }, meta, "VENDOR");
  }

  async staffOpen(principal: AuthPrincipal, input: ReportClaimInput, meta: RequestMeta): Promise<ClaimView> {
    if (input.fileIds.length > 0) {
      throw Errors.validation({ fileIds: ["Describe the evidence in the note. Files come from the vendor or the hub."] });
    }
    const country = reviewerCountryScope(principal);
    const subject = await this.subject(input, country ? { warehouse: { countryCode: country } } : {});
    return this.create(principal, subject, { ...input, source: "STAFF" }, meta, "STAFF");
  }

  async listForStaff(principal: AuthPrincipal, filters: ClaimFilters): Promise<ClaimView[]> {
    const country = reviewerCountryScope(principal);
    const where: Prisma.CustodyClaimWhereInput = {
      ...(country ? { countryCode: country } : {}),
      ...(filters.status ? { status: filters.status } : {}),
      ...(filters.partnerId ? { partnerId: filters.partnerId } : {}),
    };
    return this.list(where, "STAFF");
  }

  listForVendor(principal: AuthPrincipal): Promise<ClaimView[]> {
    return this.list({ vendorId: vendorIdOf(principal) }, "VENDOR");
  }

  listForPartner(principal: AuthPrincipal): Promise<ClaimView[]> {
    return this.list({ partnerId: this.partnerIdOf(principal), status: { not: "OPEN" } }, "PARTNER");
  }

  async staffDetail(principal: AuthPrincipal, claimId: string): Promise<ClaimView> {
    const country = reviewerCountryScope(principal);
    return this.detail({ id: claimId, ...(country ? { countryCode: country } : {}) }, "STAFF");
  }

  vendorDetail(principal: AuthPrincipal, claimId: string): Promise<ClaimView> {
    return this.detail({ id: claimId, vendorId: vendorIdOf(principal) }, "VENDOR");
  }

  partnerDetail(principal: AuthPrincipal, claimId: string): Promise<ClaimView> {
    return this.detail({ id: claimId, partnerId: this.partnerIdOf(principal), status: { not: "OPEN" } }, "PARTNER");
  }

  partnerIdOf(principal: AuthPrincipal): string {
    if (!principal.partnerId) {
      throw Errors.notFound();
    }
    return principal.partnerId;
  }

  private async create(principal: AuthPrincipal, subject: ClaimSubject, input: ReportClaimInput & { source: ClaimSource }, meta: RequestMeta, audience: "VENDOR" | "STAFF"): Promise<ClaimView> {
    const { base } = subject;
    if (input.quantity > subject.maxQuantity) {
      throw Errors.validation({ quantity: [`There ${subject.maxQuantity === 1 ? "is only 1 unit" : `are only ${subject.maxQuantity} units`} to claim for here`] });
    }
    const live = await this.prisma.custodyClaim.count({ where: { status: { in: LIVE_STATUSES }, ...(base.orderId ? { orderId: base.orderId } : { lotId: base.lotId }) } });
    if (live > 0) {
      throw Errors.invalidTransition("There's already an open claim for this. We'll update you on that one.");
    }
    const id = await this.prisma.$transaction(async (tx) => {
      const claimId = await this.open(tx, {
        ...base,
        kind: input.kind,
        source: input.source,
        quantity: input.quantity,
        description: input.description,
        evidenceFileIds: input.fileIds,
        createdBy: principal.userId,
      });
      await this.audit.record(
        {
          actor: actorOf(principal),
          action: "custody.claim_opened",
          resourceType: "custody_claim",
          resourceId: claimId,
          countryCode: base.countryCode,
          after: { kind: input.kind, quantity: input.quantity, source: input.source },
          meta,
        },
        tx,
      );
      return claimId;
    });
    const view = await this.detail({ id }, audience);
    await this.vendorAlerts.notifyOwner(base.vendorId, (to, webUrl) => CustodyEmails.claimReceived(to, view.reference, webUrl), "/claims");
    return view;
  }

  private async subject(input: ReportClaimInput, scope: { vendorId?: string; warehouse?: Prisma.WarehouseWhereInput }): Promise<ClaimSubject> {
    if (input.orderId) {
      const order = await this.prisma.order.findFirst({
        where: { id: input.orderId, ...scope, status: { in: [...SHIPPED_ORDER_STATUSES] }, mystery: null },
        select: {
          id: true,
          vendorId: true,
          warehouseId: true,
          originCountryCode: true,
          currency: true,
          warehouse: { select: { partnerId: true } },
          lines: { select: { quantity: true, unitValueMinor: true } },
        },
      });
      if (!order) {
        throw Errors.validation({ orderId: ["Choose an order that has been sent"] });
      }
      const units = order.lines.reduce((total, line) => total + line.quantity, 0);
      const value = order.lines.reduce((total, line) => total + line.quantity * line.unitValueMinor, 0);
      return {
        maxQuantity: units,
        base: {
          vendorId: order.vendorId,
          warehouseId: order.warehouseId,
          partnerId: order.warehouse.partnerId,
          countryCode: order.originCountryCode,
          lotId: null,
          orderId: order.id,
          unitValueMinor: units === 0 ? 0 : Math.floor(value / units),
          currency: order.currency,
        },
      };
    }
    const lot = await this.prisma.stockLot.findFirst({
      where: { id: input.lotId!, ...scope },
      select: {
        id: true,
        vendorId: true,
        warehouseId: true,
        quantityAvailable: true,
        quantityReserved: true,
        warehouse: { select: { partnerId: true, countryCode: true } },
        product: { select: { declaredValueMinor: true, currency: true } },
      },
    });
    if (!lot || lot.quantityAvailable + lot.quantityReserved === 0) {
      throw Errors.validation({ lotId: ["Choose stock that's still held for you"] });
    }
    return {
      maxQuantity: lot.quantityAvailable + lot.quantityReserved,
      base: {
        vendorId: lot.vendorId,
        warehouseId: lot.warehouseId,
        partnerId: lot.warehouse.partnerId,
        countryCode: lot.warehouse.countryCode,
        lotId: lot.id,
        orderId: null,
        unitValueMinor: lot.product.declaredValueMinor,
        currency: lot.product.currency,
      },
    };
  }

  private async list(where: Prisma.CustodyClaimWhereInput, audience: "STAFF" | "VENDOR" | "PARTNER"): Promise<ClaimView[]> {
    const rows = await this.prisma.custodyClaim.findMany({ where, include: CLAIM_INCLUDE, orderBy: { createdAt: "desc" }, take: 200 });
    return rows.map((row) => toClaimView(row, audience));
  }

  private async detail(where: Prisma.CustodyClaimWhereInput, audience: "STAFF" | "VENDOR" | "PARTNER"): Promise<ClaimView> {
    const row = await this.prisma.custodyClaim.findFirst({ where, include: CLAIM_INCLUDE });
    if (!row) {
      throw Errors.notFound();
    }
    return toClaimView(row, audience);
  }
}
