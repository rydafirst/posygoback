import { Injectable } from "@nestjs/common";

import type { AuthPrincipal, RequestMeta } from "../../../common/auth/auth-principal";
import { Errors } from "../../../common/http/app-exception";
import { PrismaService } from "../../../database/prisma.service";
import { AuditService } from "../../../infrastructure/audit/audit.service";
import type { ListingView, ProductListingInput } from "../../../shared";
import { vendorIdOf } from "../../onboarding/scope";

@Injectable()
export class StorefrontListingsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async list(principal: AuthPrincipal): Promise<ListingView[]> {
    const vendorId = vendorIdOf(principal);
    const products = await this.prisma.product.findMany({ where: { vendorId, status: "ACTIVE" }, orderBy: { name: "asc" }, take: 500 });
    const stock = await this.prisma.stockLot.groupBy({ by: ["productId"], where: { vendorId, condition: "SELLABLE" }, _sum: { quantityAvailable: true } });
    const available = new Map(stock.map((row) => [row.productId, row._sum.quantityAvailable ?? 0]));
    return products.map((product) => ({
      productId: product.id,
      code: product.code,
      name: product.name,
      declaredValueMinor: product.declaredValueMinor,
      retailPriceMinor: product.retailPriceMinor,
      listed: product.listed,
      description: product.description,
      category: product.category,
      available: available.get(product.id) ?? 0,
      imageUrl: product.imageFileId ? `/v1/public/products/${product.id}/image` : null,
    }));
  }

  async setListing(principal: AuthPrincipal, productId: string, input: ProductListingInput, meta: RequestMeta): Promise<ListingView[]> {
    const vendorId = vendorIdOf(principal);
    const product = await this.prisma.product.findFirst({ where: { id: productId, vendorId, status: "ACTIVE" } });
    if (!product) {
      throw Errors.notFound();
    }
    const data = {
      listed: input.listed,
      retailPriceMinor: input.retailPriceMinor ?? product.retailPriceMinor,
      description: input.description ?? product.description,
      category: input.category ?? product.category,
    };
    if (data.listed && !data.retailPriceMinor) {
      throw Errors.validation({ retailPriceMinor: ["Set a price before listing this product"] });
    }
    await this.prisma.product.update({ where: { id: productId }, data });
    await this.audit.record({
      actor: { userId: principal.userId, role: principal.role },
      action: "storefront.listing_changed",
      resourceType: "product",
      resourceId: productId,
      vendorId,
      before: { listed: product.listed, retailPriceMinor: product.retailPriceMinor },
      after: { listed: data.listed, retailPriceMinor: data.retailPriceMinor },
      meta,
    });
    return this.list(principal);
  }
}
