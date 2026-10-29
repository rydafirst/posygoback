import { Injectable } from "@nestjs/common";

import type { AuthPrincipal } from "../../../common/auth/auth-principal";
import type { SellerCountry } from "../../../common/auth/selected-country";
import { Errors } from "../../../common/http/app-exception";
import { PrismaService } from "../../../database/prisma.service";
import { AttemptLimiterService } from "../../../infrastructure/rate-limit/attempt-limiter.service";
import { rankRates, shippingWithMarkup, type ShippingEstimateInput, type ShippingEstimateView } from "../../../shared";
import { FeeSchedulesService } from "../../finance/fees/fee-schedules.service";
import { VendorStandingService } from "../../onboarding/vendor-standing.service";
import { CarrierAccountsService } from "../carriers/carrier-accounts.service";
import { CarrierError } from "../carriers/carrier.port";
import { senderFor } from "../carriers/sender";
import { estimateParcel } from "./parcel-estimate";
import { WarehouseChooserService } from "./warehouse-chooser.service";

const ESTIMATES_PER_HOUR = { name: "shipping-estimates", limit: 120, windowSeconds: 60 * 60 };

@Injectable()
export class ShippingEstimateService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly standing: VendorStandingService,
    private readonly chooser: WarehouseChooserService,
    private readonly carriers: CarrierAccountsService,
    private readonly fees: FeeSchedulesService,
    private readonly limiter: AttemptLimiterService,
  ) {}

  async estimate(principal: AuthPrincipal, country: SellerCountry, input: ShippingEstimateInput): Promise<ShippingEstimateView> {
    const vendor = await this.standing.assertCanTrade(principal);
    if (input.recipient.countryCode && input.recipient.countryCode !== country.countryCode) {
      throw Errors.validation({ "recipient.countryCode": ["Use an address in the country you're sending from"] });
    }
    await this.limiter.consume(ESTIMATES_PER_HOUR, principal.userId);
    const products = await this.prisma.product.findMany({ where: { vendorId: vendor.vendorId, id: { in: input.lines.map((line) => line.productId) }, status: "ACTIVE" } });
    if (products.length !== new Set(input.lines.map((line) => line.productId)).size) {
      throw Errors.validation({ lines: ["Choose your own active products"] });
    }
    const byId = new Map(products.map((product) => [product.id, product]));
    const needed = new Map(input.lines.map((line) => [line.productId, line.quantity]));
    const choice = await this.chooser.choose(vendor.vendorId, country.countryCode, needed);
    if (!choice.warehouse) {
      throw choice.candidates === 0 ? Errors.invalidTransition("There's no hub open in this country yet.") : Errors.insufficientStock(choice.shortProductIds.map((id) => byId.get(id)!.name));
    }
    const boxes = await this.prisma.packagingPreset.findMany({ where: { countryCode: country.countryCode, active: true } });
    const items = input.lines.map((line) => {
      const product = byId.get(line.productId)!;
      return { weightGrams: product.weightGrams, quantity: line.quantity, lengthMm: product.lengthMm, widthMm: product.widthMm, heightMm: product.heightMm };
    });
    const estimate = estimateParcel(items, boxes);
    const resolved = this.carriers.find(country.countryCode);
    if (!estimate || !resolved) {
      throw Errors.invalidTransition("Delivery prices aren't available in this country yet.");
    }
    const { schedule, currency } = await this.fees.active(country.countryCode);
    const rates = await resolved.adapter
      .quote({
        reference: `EST-${vendor.vendorId.slice(0, 8)}`,
        currency,
        from: senderFor(choice.warehouse, vendor.businessName, resolved.account),
        to: { ...input.recipient, countryCode: country.countryCode },
        parcel: estimate.parcel,
        customs: null,
      })
      .catch((error: unknown) => {
        throw error instanceof CarrierError ? Errors.carrierFailed("We couldn't get delivery prices for this address. Check it and try again.") : error;
      });
    const priced = rates.map((rate) => ({ ...rate, id: rate.providerRateId, chargeMinor: shippingWithMarkup(schedule, rate.costMinor) }));
    const ranking = rankRates(priced, input.deliveryPreference ?? "CHEAPEST");
    const byRate = new Map(priced.map((rate) => [rate.id, rate]));
    return {
      currency,
      boxLabel: estimate.boxLabel,
      sized: estimate.sized,
      productsWithoutSize: products.filter((product) => !product.lengthMm || !product.widthMm || !product.heightMm).map((product) => product.name),
      rates: ranking.order.map((id) => {
        const rate = byRate.get(id)!;
        return {
          id,
          carrier: rate.carrier,
          service: rate.service,
          chargeMinor: rate.chargeMinor,
          estimatedDays: rate.estimatedDays,
          tags: ranking.tags.get(id) ?? [],
          preferred: id === ranking.preferredId,
        };
      }),
    };
  }
}
