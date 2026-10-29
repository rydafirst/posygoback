import { randomInt } from "node:crypto";

import type { CarrierAdapter, CarrierRate, LabelRate, PurchasedLabel, RateRequest, TrackingSnapshot } from "./carrier.port";

const CARRIER = "Sandbox Post";
const CARRIER_CODE = "sandbox_post";

export class SandboxCarrier implements CarrierAdapter {
  readonly provider = "SANDBOX" as const;
  readonly practice = true;

  quote(request: RateRequest): Promise<CarrierRate[]> {
    const crossBorder = request.from.countryCode !== request.to.countryCode;
    const standard = 295 + Math.ceil(request.parcel.weightGrams / 100) * 35 + (crossBorder ? 1200 : 0);
    return Promise.resolve([
      {
        providerRateId: `sbx_standard_${request.reference}`,
        carrier: CARRIER,
        carrierCode: CARRIER_CODE,
        service: "Standard",
        costMinor: standard,
        currency: request.currency,
        estimatedDays: crossBorder ? 6 : 3,
      },
      {
        providerRateId: `sbx_express_${request.reference}`,
        carrier: CARRIER,
        carrierCode: CARRIER_CODE,
        service: "Express",
        costMinor: standard * 2,
        currency: request.currency,
        estimatedDays: crossBorder ? 3 : 1,
      },
    ]);
  }

  buyLabel(rate: LabelRate): Promise<PurchasedLabel> {
    const trackingNumber = `SBX${Array.from({ length: 12 }, () => randomInt(10)).join("")}`;
    return Promise.resolve({
      transactionId: `sbx_tx_${trackingNumber}`,
      carrier: rate.carrier,
      carrierCode: rate.carrierCode,
      service: rate.service,
      trackingNumber,
      labelUrl: null,
      trackingUrl: null,
    });
  }

  findLabel(): Promise<null> {
    return Promise.resolve(null);
  }

  voidLabel(): Promise<boolean> {
    return Promise.resolve(true);
  }

  track(carrier: string, trackingNumber: string): Promise<TrackingSnapshot> {
    return Promise.resolve({ carrier, trackingNumber, events: [] });
  }

  trackingTarget(): null {
    return null;
  }
}
