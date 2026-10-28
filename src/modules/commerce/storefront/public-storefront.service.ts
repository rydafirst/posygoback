import { Injectable } from "@nestjs/common";

import { Errors } from "../../../common/http/app-exception";
import { PrismaService } from "../../../database/prisma.service";
import type { Prisma } from "../../../generated/prisma/client";
import { type CountryConfig, type PublicProductView, type PublicStoreListing, type PublicStoreView, type StorefrontTone } from "../../../shared";
import { CountriesRepository } from "../../countries/countries.repository";
import { FilesService } from "../../files/files.service";

const SHIPPING_WAREHOUSE: Prisma.WarehouseWhereInput = { active: true, OR: [{ partnerId: null }, { partner: { status: "ACTIVE" } }] };
const MARKETPLACE_LIMIT = 120;
const LISTING_LIMIT = 5000;

type StoreRow = { vendorId: string; slug: string; displayName: string; tone: string; vendor: { countryCode: string; country: { currency: string } } };

@Injectable()
export class PublicStorefrontService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly files: FilesService,
    private readonly countries: CountriesRepository,
  ) {}

  async listing(): Promise<PublicStoreListing[]> {
    const stores = await this.prisma.storefront.findMany({
      where: { status: "LIVE", vendor: { status: "ACTIVE" } },
      select: { slug: true, displayName: true, updatedAt: true, vendor: { select: { countryCode: true } } },
      orderBy: { updatedAt: "desc" },
      take: LISTING_LIMIT,
    });
    return stores.map((store) => ({ slug: store.slug, displayName: store.displayName, countryCode: store.vendor.countryCode, updatedAt: store.updatedAt.toISOString() }));
  }

  async store(slug: string): Promise<PublicStoreView> {
    const store = await this.prisma.storefront.findFirst({
      where: { slug, status: "LIVE", vendor: { status: "ACTIVE" } },
      include: { vendor: { select: { countryCode: true, country: { select: { currency: true, config: true } } } } },
    });
    if (!store) {
      throw Errors.notFound();
    }
    const config = store.vendor.country.config as unknown as CountryConfig;
    return {
      slug: store.slug,
      displayName: store.displayName,
      about: store.about,
      tone: store.tone as StorefrontTone,
      currency: store.vendor.country.currency,
      countryCode: store.vendor.countryCode,
      pricesIncludeTax: config.tax.pricesIncludeTax,
      returnsAllowed: store.returnsAllowed,
      returnWindowDays: store.returnWindowDays,
      destinations: await this.countries.domesticDestinations(store.vendor.countryCode),
      products: await this.products([store]),
    };
  }

  async marketplace(countryCode: string, category?: string): Promise<PublicProductView[]> {
    const stores = await this.prisma.storefront.findMany({
      where: { status: "LIVE", vendor: { status: "ACTIVE", countryCode } },
      include: { vendor: { select: { countryCode: true, country: { select: { currency: true } } } } },
      take: 200,
    });
    return (await this.products(stores, category)).slice(0, MARKETPLACE_LIMIT);
  }

  async imageUrl(productId: string): Promise<string> {
    const product = await this.prisma.product.findFirst({ where: { id: productId, listed: true, status: "ACTIVE", vendor: { storefront: { status: "LIVE" } } }, select: { imageFileId: true } });
    if (!product?.imageFileId) {
      throw Errors.notFound();
    }
    return this.files.publicImageUrl(product.imageFileId);
  }

  private async products(stores: readonly StoreRow[], category?: string): Promise<PublicProductView[]> {
    if (stores.length === 0) {
      return [];
    }
    const byVendor = new Map(stores.map((store) => [store.vendorId, store]));
    const products = await this.prisma.product.findMany({
      where: { vendorId: { in: [...byVendor.keys()] }, listed: true, status: "ACTIVE", ...(category ? { category } : {}) },
      orderBy: [{ category: "asc" }, { name: "asc" }],
      take: 500,
    });
    const stock = await this.prisma.stockLot.groupBy({
      by: ["productId"],
      where: { productId: { in: products.map((product) => product.id) }, condition: "SELLABLE", quantityAvailable: { gt: 0 }, warehouse: SHIPPING_WAREHOUSE },
      _sum: { quantityAvailable: true },
    });
    const inStock = new Set(stock.filter((row) => (row._sum.quantityAvailable ?? 0) > 0).map((row) => row.productId));
    return products.map((product) => {
      const store = byVendor.get(product.vendorId)!;
      return {
        id: product.id,
        name: product.name,
        description: product.description,
        category: product.category,
        priceMinor: product.retailPriceMinor ?? 0,
        currency: store.vendor.country.currency,
        inStock: inStock.has(product.id),
        imageUrl: product.imageFileId ? `/v1/public/products/${product.id}/image` : null,
        store: { slug: store.slug, displayName: store.displayName, tone: store.tone as StorefrontTone },
      };
    });
  }
}

export { SHIPPING_WAREHOUSE };
