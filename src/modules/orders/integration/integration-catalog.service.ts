import { Injectable } from "@nestjs/common";

import { Errors } from "../../../common/http/app-exception";
import { PrismaService } from "../../../database/prisma.service";
import type { IntegrationAccountView, IntegrationStockView } from "../../../shared";
import type { ApiClient } from "./api-keys.service";

@Injectable()
export class IntegrationCatalogService {
  constructor(private readonly prisma: PrismaService) {}

  async account(client: ApiClient): Promise<IntegrationAccountView> {
    const vendor = await this.prisma.vendor.findUniqueOrThrow({
      where: { id: client.vendorId },
      select: { businessName: true, countries: { select: { countryCode: true }, orderBy: { countryCode: "asc" } } },
    });
    return { businessName: vendor.businessName, countries: vendor.countries.map((row) => row.countryCode) };
  }

  async stock(client: ApiClient, country: string): Promise<IntegrationStockView> {
    const added = await this.prisma.vendorCountry.findUnique({ where: { vendorId_countryCode: { vendorId: client.vendorId, countryCode: country } } });
    if (!added) {
      throw Errors.notFound();
    }
    const [products, lots] = await Promise.all([
      this.prisma.product.findMany({ where: { vendorId: client.vendorId, status: "ACTIVE" }, select: { id: true, code: true }, orderBy: { code: "asc" } }),
      this.prisma.stockLot.groupBy({ by: ["productId"], where: { vendorId: client.vendorId, warehouse: { countryCode: country } }, _sum: { quantityAvailable: true } }),
    ]);
    const available = new Map(lots.map((row) => [row.productId, row._sum.quantityAvailable ?? 0]));
    return { country, items: products.map((product) => ({ productCode: product.code, available: available.get(product.id) ?? 0 })) };
  }
}
