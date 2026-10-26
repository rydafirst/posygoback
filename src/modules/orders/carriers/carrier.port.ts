import type { CarrierTrackingEvent } from "../../../shared";

export interface ShipmentParty {
  name: string;
  company?: string;
  line1: string;
  line2?: string;
  city: string;
  region?: string;
  postalCode: string;
  countryCode: string;
  phone?: string;
  email?: string;
}

export interface ParcelSpec {
  lengthMm: number;
  widthMm: number;
  heightMm: number;
  weightGrams: number;
}

export interface CustomsItem {
  description: string;
  quantity: number;
  unitValueMinor: number;
  netWeightGrams: number;
  originCountry: string;
  hsCode: string;
}

export interface RateRequest {
  reference: string;
  currency: string;
  from: ShipmentParty;
  to: ShipmentParty;
  parcel: ParcelSpec;
  customs: CustomsItem[] | null;
}

export interface CarrierRate {
  providerRateId: string;
  carrier: string;
  carrierCode: string;
  service: string;
  costMinor: number;
  currency: string;
  estimatedDays: number | null;
}

export interface PurchasedLabel {
  transactionId: string;
  carrier: string;
  carrierCode: string;
  service: string;
  trackingNumber: string;
  labelUrl: string | null;
  trackingUrl: string | null;
}

export interface TrackingSnapshot {
  carrier: string;
  trackingNumber: string;
  events: CarrierTrackingEvent[];
}

export interface CarrierAdapter {
  readonly provider: "SHIPPO" | "SANDBOX";
  quote(request: RateRequest): Promise<CarrierRate[]>;
  buyLabel(rate: LabelRate, reference: string): Promise<PurchasedLabel>;
  findLabel(rate: LabelRate): Promise<PurchasedLabel | null>;
  voidLabel(transactionId: string): Promise<boolean>;
  track(carrier: string, trackingNumber: string): Promise<TrackingSnapshot>;
  trackingTarget(body: unknown): { carrier: string; trackingNumber: string } | null;
}

export type LabelRate = Pick<CarrierRate, "providerRateId" | "carrier" | "carrierCode" | "service">;

export function carrierCodeFor(carrier: string): string {
  return carrier
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_|_$/g, "")
    .slice(0, 40);
}

export class CarrierError extends Error {
  constructor(
    message: string,
    readonly definite: boolean,
  ) {
    super(message);
    this.name = "CarrierError";
  }
}
