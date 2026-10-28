import { Injectable } from "@nestjs/common";

import { AppException, Errors } from "../../../common/http/app-exception";
import { PrismaService } from "../../../database/prisma.service";
import type { Storefront, Warehouse } from "../../../generated/prisma/client";
import { type CountryConfig, type FeeSchedule, goodsTotal, prefixProblems, type QuoteInput, recipientProblems, storefrontRates, type TaxRules } from "../../../shared";
import { FeeSchedulesService } from "../../finance/fees/fee-schedules.service";
import { VendorStandingService } from "../../onboarding/vendor-standing.service";
import { WarehouseChooserService } from "../../orders/core/warehouse-chooser.service";
import { type DeliveryOption, DeliveryQuotesService, type QuoteLine } from "./delivery-quotes.service";
import { DiscountsService } from "./discounts.service";

export interface PreparedCheckout {
  store: Storefront;
  countryCode: string;
  currency: string;
  tax: TaxRules;
  commissionBps: number;
  minimumHoldHours: number;
  schedule: FeeSchedule;
  lines: QuoteLine[];
  warehouse: Warehouse;
  goodsMinor: number;
  discount: { id: string; minor: number } | null;
  discountProblem: string | null;
  options: DeliveryOption[];
}

@Injectable()
export class CheckoutPreparationService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly standing: VendorStandingService,
    private readonly chooser: WarehouseChooserService,
    private readonly fees: FeeSchedulesService,
    private readonly delivery: DeliveryQuotesService,
    private readonly discounts: DiscountsService,
  ) {}

  async prepare(slug: string, input: QuoteInput): Promise<PreparedCheckout> {
    const store = await this.prisma.storefront.findFirst({ where: { slug, status: "LIVE" }, include: { vendor: { include: { country: true } } } });
    if (!store) {
      throw Errors.notFound();
    }
    await this.standing.assertVendorCanTrade(store.vendorId).catch((error: unknown) => {
      throw error instanceof AppException ? Errors.notFound() : error;
    });
    const products = await this.prisma.product.findMany({ where: { vendorId: store.vendorId, id: { in: input.items.map((item) => item.productId) }, listed: true, status: "ACTIVE" } });
    if (products.length !== input.items.length) {
      throw Errors.validation({ items: ["Some items in your basket are no longer for sale. Remove them and try again"] });
    }
    const byId = new Map(products.map((product) => [product.id, product]));
    const lines = input.items.map((item) => ({ product: byId.get(item.productId)!, quantity: item.quantity }));
    const choice = await this.chooser.choose(store.vendorId, store.vendor.countryCode, new Map(lines.map((line) => [line.product.id, line.quantity])));
    if (!choice.warehouse) {
      throw Errors.validation({ items: [`Not enough left of ${choice.shortProductIds.map((id) => byId.get(id)?.name ?? "an item").join(", ")}`] });
    }
    this.assertDeliverable(store.vendor.countryCode, store.vendor.country.config as unknown as CountryConfig, input);
    const active = await this.fees.active(choice.warehouse.countryCode);
    const rates = storefrontRates(active.schedule);
    const goodsMinor = goodsTotal(lines.map((line) => ({ unitPriceMinor: line.product.retailPriceMinor ?? 0, quantity: line.quantity })));
    const discount = input.discountCode ? await this.discounts.quote(store.vendorId, input.discountCode, goodsMinor) : null;
    const config = store.vendor.country.config as unknown as CountryConfig;
    return {
      store,
      countryCode: store.vendor.countryCode,
      currency: store.vendor.country.currency,
      tax: config.tax,
      commissionBps: rates.commissionBps,
      minimumHoldHours: rates.minimumHoldHours,
      schedule: active.schedule,
      lines,
      warehouse: choice.warehouse,
      goodsMinor,
      discount: discount?.ok ? { id: discount.id, minor: discount.discountMinor } : null,
      discountProblem: discount && !discount.ok ? discount.problem : null,
      options: await this.delivery.options(choice.warehouse, input.shipTo, lines, store.vendor.country.currency, active.schedule),
    };
  }

  private assertDeliverable(countryCode: string, config: CountryConfig, input: QuoteInput): void {
    if (input.shipTo.countryCode !== countryCode) {
      throw Errors.validation({ "shipTo.countryCode": ["This store only delivers within its own country"] });
    }
    const problems = prefixProblems(recipientProblems(input.shipTo, config.address), "shipTo");
    if (Object.keys(problems).length > 0) {
      throw Errors.validation(problems);
    }
  }
}
