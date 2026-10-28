import { Injectable } from "@nestjs/common";

import type { AuthPrincipal } from "../../common/auth/auth-principal";
import { PrismaService } from "../../database/prisma.service";
import type { Prisma } from "../../generated/prisma/client";
import { DIRECTORY_PAGE_SIZE, type DirectoryPage, type ProductDirectoryQuery, type ProductRowView, productStockState } from "../../shared";
import { warehouseCountryScope } from "../stock/scope";
import { productSearchWhere, productStockWhere } from "./directory-filters";
import { StockFiguresRepository } from "./stock-figures.repository";

const VENDOR_PRODUCTS_SHOWN = 200;

const PRODUCT_INCLUDE = { vendor: { select: { businessName: true } }, createdBy: { select: { email: true } } } satisfies Prisma.ProductInclude;

type ProductRow = Prisma.ProductGetPayload<{ include: typeof PRODUCT_INCLUDE }>;

@Injectable()
export class ProductDirectoryService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly stock: StockFiguresRepository,
  ) {}

  async list(principal: AuthPrincipal, query: ProductDirectoryQuery): Promise<DirectoryPage<ProductRowView>> {
    const country = warehouseCountryScope(principal);
    const where: Prisma.ProductWhereInput = {
      AND: [country ? { vendor: { countryCode: country } } : {}, query.vendorId ? { vendorId: query.vendorId } : {}, productSearchWhere(query.q), productStockWhere(query.stock)],
    };
    const [total, rows] = await Promise.all([
      this.prisma.product.count({ where }),
      this.prisma.product.findMany({ where, include: PRODUCT_INCLUDE, orderBy: [{ createdAt: "desc" }, { id: "asc" }], skip: (query.page - 1) * DIRECTORY_PAGE_SIZE, take: DIRECTORY_PAGE_SIZE }),
    ]);
    return { items: await this.toRows(rows), total, page: query.page, pageSize: DIRECTORY_PAGE_SIZE };
  }

  async forVendor(vendorId: string): Promise<ProductRowView[]> {
    const rows = await this.prisma.product.findMany({ where: { vendorId }, include: PRODUCT_INCLUDE, orderBy: [{ createdAt: "desc" }, { id: "asc" }], take: VENDOR_PRODUCTS_SHOWN });
    return this.toRows(rows);
  }

  private async toRows(rows: ProductRow[]): Promise<ProductRowView[]> {
    const factsFor = await this.stock.forProducts(rows.map((row) => row.id));
    return rows.map((row) => {
      const facts = factsFor(row.id);
      return {
        id: row.id,
        name: row.name,
        code: row.code,
        variantLabel: row.variantLabel,
        vendorId: row.vendorId,
        businessName: row.vendor.businessName,
        addedByEmail: row.createdBy?.email ?? null,
        addedAt: row.createdAt.toISOString(),
        unitsInStorage: facts.unitsInStorage,
        unitsOnTheWay: facts.unitsOnTheWay,
        stockState: productStockState(facts),
      };
    });
  }
}
