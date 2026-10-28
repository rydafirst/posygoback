import type { Prisma } from "../../generated/prisma/client";
import { OPEN_INBOUND_STATUSES, type ProductStockState, type VendorStage, VERIFYING_STATUSES } from "../../shared";

const VERIFIED: Prisma.VendorWhereInput = { status: "PENDING_VERIFICATION", verification: { is: { status: "APPROVED" } } };

const VERIFYING: Prisma.VendorWhereInput = {
  status: "PENDING_VERIFICATION",
  verification: { is: { status: { in: [...VERIFYING_STATUSES] } } },
  users: { some: { role: "VENDOR_OWNER", emailVerifiedAt: { not: null } } },
};

const STAGE_WHERE: Record<VendorStage, Prisma.VendorWhereInput> = {
  SIGNED_UP: { status: "PENDING_VERIFICATION", NOT: [VERIFIED, VERIFYING] },
  VERIFYING,
  VERIFIED,
  LIVE: { status: "ACTIVE" },
  SUSPENDED: { status: { in: ["SUSPENDED", "CLOSED"] } },
};

export const HELD_LOT: Prisma.StockLotWhereInput = { OR: [{ quantityAvailable: { gt: 0 } }, { quantityReserved: { gt: 0 } }] };

export const ON_THE_WAY_LINE: Prisma.InboundLineWhereInput = { inbound: { status: { in: [...OPEN_INBOUND_STATUSES] } } };

const IN_STORAGE: Prisma.ProductWhereInput = { lots: { some: HELD_LOT } };
const ON_THE_WAY: Prisma.ProductWhereInput = { inboundLines: { some: ON_THE_WAY_LINE } };

const STOCK_WHERE: Record<ProductStockState, Prisma.ProductWhereInput> = {
  IN_STORAGE,
  ON_THE_WAY: { ...ON_THE_WAY, NOT: [IN_STORAGE] },
  SOLD_OUT: { lots: { some: {} }, NOT: [IN_STORAGE, ON_THE_WAY] },
  NOT_SENT: { lots: { none: {} }, NOT: [ON_THE_WAY] },
};

export function vendorStageWhere(stage: VendorStage | undefined): Prisma.VendorWhereInput {
  return stage ? STAGE_WHERE[stage] : {};
}

export function productStockWhere(state: ProductStockState | undefined): Prisma.ProductWhereInput {
  return state ? STOCK_WHERE[state] : {};
}

export function vendorSearchWhere(search: string | undefined): Prisma.VendorWhereInput {
  if (!search) {
    return {};
  }
  return {
    OR: [{ businessName: { contains: search, mode: "insensitive" } }, { users: { some: { role: "VENDOR_OWNER", email: { contains: search, mode: "insensitive" } } } }],
  };
}

export function productSearchWhere(search: string | undefined): Prisma.ProductWhereInput {
  if (!search) {
    return {};
  }
  return { OR: [{ name: { contains: search, mode: "insensitive" } }, { code: { contains: search, mode: "insensitive" } }] };
}
