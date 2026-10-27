import { Injectable } from "@nestjs/common";

import { Errors } from "../../../common/http/app-exception";
import { PrismaService } from "../../../database/prisma.service";
import type { Product, Warehouse } from "../../../generated/prisma/client";
import { type DeliverySpeed, type FeeSchedule, type ShipTo, shippingWithMarkup } from "../../../shared";
import { CarrierAccountsService } from "../../orders/carriers/carrier-accounts.service";
import type { CarrierRate, CustomsItem, ShipmentParty } from "../../orders/carriers/carrier.port";
import { PLATFORM_NAME } from "../../../common/brand/brand";

const PACKING_ALLOWANCE_GRAMS = 200;
const FALLBACK_BOX = { lengthMm: 300, widthMm: 200, heightMm: 150 };
const SPACE_FACTOR = 1.3;
const DEFAULT_DAYS = 4;

export interface DeliveryOption {
  speed: DeliverySpeed;
  label: string;
  window: string;
  priceMinor: number;
}

export interface Parcel {
  lengthMm: number;
  widthMm: number;
  heightMm: number;
  weightGrams: number;
}

export interface QuoteLine {
  product: Product;
  quantity: number;
}

export function warehouseParty(warehouse: Warehouse): ShipmentParty {
  const addressLines = warehouse.addressLines as string[];
  return {
    name: `${PLATFORM_NAME} ${warehouse.name}`.slice(0, 100),
    line1: addressLines[0] ?? "",
    line2: addressLines[1],
    city: warehouse.city,
    postalCode: warehouse.postalCode,
    countryCode: warehouse.countryCode,
  };
}

export function shipToParty(shipTo: ShipTo): ShipmentParty {
  return { name: shipTo.name, line1: shipTo.line1, line2: shipTo.line2, city: shipTo.city, region: shipTo.region, postalCode: shipTo.postalCode, countryCode: shipTo.countryCode, phone: shipTo.phone };
}

function windowFor(days: number): string {
  return `${days}–${days + 2} working days`;
}

@Injectable()
export class DeliveryQuotesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly carriers: CarrierAccountsService,
  ) {}

  async options(warehouse: Warehouse, shipTo: ShipTo, lines: readonly QuoteLine[], currency: string, schedule: FeeSchedule, customsRequired: boolean): Promise<DeliveryOption[]> {
    return this.optionsFor(warehouse, shipTo, await this.parcel(warehouse.countryCode, lines), customsRequired ? this.customs(lines) : null, currency, schedule);
  }

  async optionsFor(warehouse: Warehouse, shipTo: ShipTo, parcel: Parcel, customs: CustomsItem[] | null, currency: string, schedule: FeeSchedule): Promise<DeliveryOption[]> {
    const usable = await this.rates(warehouse, shipTo, parcel, customs, currency);
    const cheapest = this.choose(usable, "STANDARD");
    const fastest = this.choose(usable, "EXPRESS");
    const standardDays = cheapest.estimatedDays ?? DEFAULT_DAYS;
    const options: DeliveryOption[] = [{ speed: "STANDARD", label: "Standard", window: windowFor(standardDays), priceMinor: shippingWithMarkup(schedule, cheapest.costMinor) }];
    if (fastest !== cheapest && (fastest.estimatedDays ?? DEFAULT_DAYS) < standardDays) {
      options.push({ speed: "EXPRESS", label: "Express", window: windowFor(fastest.estimatedDays ?? 1), priceMinor: shippingWithMarkup(schedule, fastest.costMinor) });
    }
    return options;
  }

  async rates(warehouse: Warehouse, shipTo: ShipTo, parcel: Parcel, customs: CustomsItem[] | null, currency: string, reference = `quote-${warehouse.code}`): Promise<CarrierRate[]> {
    const resolved = this.carriers.find(warehouse.countryCode);
    if (!resolved) {
      throw Errors.invalidTransition("Delivery isn't available from this warehouse yet.");
    }
    const rates = await resolved.adapter.quote({ reference, currency, from: warehouseParty(warehouse), to: shipToParty(shipTo), parcel, customs }).catch(() => [] as CarrierRate[]);
    const usable = rates.filter((rate) => rate.currency === currency);
    if (usable.length === 0) {
      throw Errors.invalidTransition("We couldn't price delivery to this address. Check it and try again.");
    }
    return usable;
  }

  choose(rates: readonly CarrierRate[], speed: DeliverySpeed): CarrierRate {
    const sorted =
      speed === "STANDARD"
        ? [...rates].sort((left, right) => left.costMinor - right.costMinor)
        : [...rates].sort((left, right) => (left.estimatedDays ?? DEFAULT_DAYS) - (right.estimatedDays ?? DEFAULT_DAYS) || left.costMinor - right.costMinor);
    return sorted[0]!;
  }

  private async parcel(countryCode: string, lines: readonly QuoteLine[]): Promise<Parcel> {
    const weightGrams = lines.reduce((total, line) => total + line.product.weightGrams * line.quantity, PACKING_ALLOWANCE_GRAMS);
    const volume = lines.reduce((total, line) => total + (line.product.lengthMm ?? 0) * (line.product.widthMm ?? 0) * (line.product.heightMm ?? 0) * line.quantity, 0) * SPACE_FACTOR;
    const boxes = await this.prisma.packagingPreset.findMany({ where: { countryCode, active: true }, orderBy: { code: "asc" } });
    const bySize = boxes.map((box) => ({ box, volume: box.lengthMm * box.widthMm * box.heightMm })).sort((left, right) => left.volume - right.volume);
    const fits = bySize.find((entry) => entry.volume >= volume) ?? bySize.at(-1);
    const box = fits?.box ?? FALLBACK_BOX;
    return { lengthMm: box.lengthMm, widthMm: box.widthMm, heightMm: box.heightMm, weightGrams };
  }

  private customs(lines: readonly QuoteLine[]): CustomsItem[] {
    return lines.map((line) => ({
      description: line.product.name,
      quantity: line.quantity,
      unitValueMinor: line.product.declaredValueMinor,
      netWeightGrams: line.product.weightGrams,
      originCountry: line.product.countryOfOrigin,
      hsCode: line.product.hsCode ?? "",
    }));
  }
}
