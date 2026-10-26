import type { Prisma } from "../../../generated/prisma/client";
import type { ClaimView, CustodyAlertView, TransferView } from "../../../shared";

export const CLAIM_INCLUDE = {
  vendor: { select: { businessName: true } },
  warehouse: { select: { name: true } },
  partner: { select: { legalName: true } },
  lot: { select: { code: true, product: { select: { name: true } } } },
  order: { select: { reference: true } },
  assessor: { select: { email: true } },
  decider: { select: { email: true } },
} satisfies Prisma.CustodyClaimInclude;

export type ClaimRow = Prisma.CustodyClaimGetPayload<{ include: typeof CLAIM_INCLUDE }>;

export function toClaimView(row: ClaimRow, audience: "STAFF" | "VENDOR" | "PARTNER"): ClaimView {
  const staff = audience === "STAFF";
  return {
    id: row.id,
    reference: row.reference,
    countryCode: row.countryCode,
    vendorName: audience === "PARTNER" ? null : row.vendor.businessName,
    warehouseName: row.warehouse.name,
    partnerId: staff ? row.partnerId : null,
    partnerName: staff ? (row.partner?.legalName ?? null) : null,
    kind: row.kind,
    source: row.source,
    productName: row.lot?.product.name ?? null,
    lotCode: row.lot?.code ?? null,
    orderReference: row.order?.reference ?? null,
    quantity: row.quantity,
    unitValueMinor: Number(row.unitValueMinor),
    amountMinor: Number(row.amountMinor),
    currency: row.currency,
    description: row.description,
    evidenceFileIds: staff ? (row.evidenceFileIds as string[]) : [],
    status: row.status,
    liability: row.liability,
    writeOff: row.writeOff,
    assessmentNote: row.assessmentNote,
    assessedByEmail: staff ? (row.assessor?.email ?? null) : null,
    partnerResponse: audience === "VENDOR" ? null : row.partnerResponse,
    decisionNote: row.decisionNote,
    decidedByEmail: staff ? (row.decider?.email ?? null) : null,
    compensationMinor: Number(row.compensationMinor),
    recoveredLedgerMinor: audience === "VENDOR" ? 0 : Number(row.recoveredLedgerMinor),
    recoveredDepositMinor: audience === "VENDOR" ? 0 : Number(row.recoveredDepositMinor),
    platformCoverMinor: staff ? Number(row.platformCoverMinor) : 0,
    createdAt: row.createdAt.toISOString(),
    decidedAt: row.decidedAt?.toISOString() ?? null,
  };
}

export const ALERT_INCLUDE = { partner: { select: { legalName: true } }, warehouse: { select: { name: true } } } satisfies Prisma.CustodyAlertInclude;
export type AlertRow = Prisma.CustodyAlertGetPayload<{ include: typeof ALERT_INCLUDE }>;

export function toAlertView(row: AlertRow): CustodyAlertView {
  return {
    id: row.id,
    kind: row.kind,
    status: row.status,
    countryCode: row.countryCode,
    partnerId: row.partnerId,
    partnerName: row.partner?.legalName ?? null,
    warehouseName: row.warehouse?.name ?? null,
    subjectType: row.subjectType,
    subjectId: row.subjectId,
    message: row.message,
    resolutionNote: row.resolutionNote,
    createdAt: row.createdAt.toISOString(),
    resolvedAt: row.resolvedAt?.toISOString() ?? null,
  };
}

export const TRANSFER_INCLUDE = {
  fromWarehouse: { select: { id: true, name: true, code: true } },
  toWarehouse: { select: { id: true, name: true, code: true } },
  lines: { include: { lot: { select: { code: true, product: { select: { name: true } }, vendor: { select: { businessName: true } } } } }, orderBy: { id: "asc" } },
} satisfies Prisma.StockTransferInclude;

export type TransferRow = Prisma.StockTransferGetPayload<{ include: typeof TRANSFER_INCLUDE }>;

export function toTransferView(row: TransferRow, actions: TransferView["actions"], showVendors: boolean): TransferView {
  return {
    id: row.id,
    reference: row.reference,
    countryCode: row.countryCode,
    fromWarehouse: row.fromWarehouse,
    toWarehouse: row.toWarehouse,
    status: row.status,
    reason: row.reason,
    carrier: row.carrier,
    trackingNumber: row.trackingNumber,
    sealNumber: row.sealNumber,
    dispatchedAt: row.dispatchedAt?.toISOString() ?? null,
    receivedAt: row.receivedAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
    units: row.lines.reduce((total, line) => total + line.quantitySent, 0),
    lines: row.lines.map((line) => ({
      id: line.id,
      lotId: line.lotId,
      lotCode: line.lot.code,
      productName: line.lot.product.name,
      vendorName: showVendors ? line.lot.vendor.businessName : null,
      quantitySent: line.quantitySent,
      quantityReceived: line.quantityReceived,
    })),
    actions,
  };
}
