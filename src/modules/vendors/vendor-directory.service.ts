import { Injectable } from "@nestjs/common";

import type { AuthPrincipal } from "../../common/auth/auth-principal";
import { Errors } from "../../common/http/app-exception";
import { PrismaService } from "../../database/prisma.service";
import type { Prisma, User, VendorVerification, Wallet } from "../../generated/prisma/client";
import { DIRECTORY_PAGE_SIZE, type DirectoryPage, type VendorDetailView, type VendorDirectoryQuery, type VendorRowView, vendorStage } from "../../shared";
import { warehouseCountryScope } from "../stock/scope";
import { vendorSearchWhere, vendorStageWhere } from "./directory-filters";
import { ProductDirectoryService } from "./product-directory.service";
import { StockFiguresRepository } from "./stock-figures.repository";

const ROW_INCLUDE = {
  users: { where: { role: "VENDOR_OWNER" }, select: { email: true, emailVerifiedAt: true }, orderBy: { createdAt: "asc" }, take: 1 },
  verification: { select: { status: true } },
  wallets: { select: { currency: true, balanceMinor: true } },
  country: { select: { currency: true } },
  _count: { select: { products: true } },
} satisfies Prisma.VendorInclude;

const DETAIL_INCLUDE = {
  users: { orderBy: { createdAt: "asc" } },
  verification: true,
  destinations: { orderBy: { countryCode: "asc" } },
  wallets: { select: { currency: true, balanceMinor: true } },
  country: { select: { currency: true } },
  _count: { select: { products: true, inboundShipments: true, orders: true } },
} satisfies Prisma.VendorInclude;

type StageSource = { status: Parameters<typeof vendorStage>[0]["vendorStatus"]; verification: Pick<VendorVerification, "status"> | null };

function stageOf(vendor: StageSource, owner: Pick<User, "emailVerifiedAt"> | undefined) {
  return vendorStage({ vendorStatus: vendor.status, verificationStatus: vendor.verification?.status ?? null, ownerEmailVerified: Boolean(owner?.emailVerifiedAt) });
}

function walletIn(wallets: ReadonlyArray<Pick<Wallet, "currency" | "balanceMinor">>, currency: string) {
  return { balanceMinor: Number(wallets.find((wallet) => wallet.currency === currency)?.balanceMinor ?? 0n), currency };
}

@Injectable()
export class VendorDirectoryService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly stock: StockFiguresRepository,
    private readonly products: ProductDirectoryService,
  ) {}

  async list(principal: AuthPrincipal, query: VendorDirectoryQuery): Promise<DirectoryPage<VendorRowView>> {
    const country = warehouseCountryScope(principal) ?? query.country;
    const where: Prisma.VendorWhereInput = { AND: [country ? { countryCode: country } : {}, vendorSearchWhere(query.q), vendorStageWhere(query.stage)] };
    const [total, rows] = await Promise.all([
      this.prisma.vendor.count({ where }),
      this.prisma.vendor.findMany({ where, include: ROW_INCLUDE, orderBy: [{ createdAt: "desc" }, { id: "asc" }], skip: (query.page - 1) * DIRECTORY_PAGE_SIZE, take: DIRECTORY_PAGE_SIZE }),
    ]);
    const unitsFor = await this.stock.unitsInStorageByVendor(rows.map((row) => row.id));
    const items = rows.map((row): VendorRowView => {
      const wallet = walletIn(row.wallets, row.country.currency);
      return {
        id: row.id,
        businessName: row.businessName,
        ownerEmail: row.users[0]?.email ?? null,
        countryCode: row.countryCode,
        joinedAt: row.createdAt.toISOString(),
        stage: stageOf(row, row.users[0]),
        verificationStatus: row.verification?.status ?? "NOT_STARTED",
        productCount: row._count.products,
        unitsInStorage: unitsFor(row.id),
        walletBalanceMinor: wallet.balanceMinor,
        currency: wallet.currency,
      };
    });
    return { items, total, page: query.page, pageSize: DIRECTORY_PAGE_SIZE };
  }

  async detail(principal: AuthPrincipal, vendorId: string): Promise<VendorDetailView> {
    const country = warehouseCountryScope(principal);
    const vendor = await this.prisma.vendor.findFirst({ where: { id: vendorId, ...(country ? { countryCode: country } : {}) }, include: DETAIL_INCLUDE });
    if (!vendor) {
      throw Errors.notFound();
    }
    const [unitsFor, products] = await Promise.all([this.stock.unitsInStorageByVendor([vendor.id]), this.products.forVendor(vendor.id)]);
    const owner = vendor.users.find((user) => user.role === "VENDOR_OWNER");
    return {
      id: vendor.id,
      businessName: vendor.businessName,
      countryCode: vendor.countryCode,
      joinedAt: vendor.createdAt.toISOString(),
      stage: stageOf(vendor, owner),
      isTestAccount: vendor.isTestAccount,
      members: vendor.users.map((user) => ({
        userId: user.id,
        email: user.email,
        role: user.role,
        status: user.status,
        emailVerified: user.emailVerifiedAt !== null,
        joinedAt: user.createdAt.toISOString(),
      })),
      verification: {
        status: vendor.verification?.status ?? "NOT_STARTED",
        submittedAt: vendor.verification?.submittedAt?.toISOString() ?? null,
        decidedAt: vendor.verification?.decidedAt?.toISOString() ?? null,
      },
      destinations: vendor.destinations.map((destination) => destination.countryCode),
      wallet: walletIn(vendor.wallets, vendor.country.currency),
      counts: { products: vendor._count.products, inboundShipments: vendor._count.inboundShipments, orders: vendor._count.orders },
      unitsInStorage: unitsFor(vendor.id),
      products,
    };
  }
}
