import type { CarrierTrackingEvent, TrackingStatus } from "../../../shared";
import { decimalToMinor, minorToDecimal } from "./carrier-money";
import { type CarrierAdapter, carrierCodeFor, CarrierError, type CarrierRate, type LabelRate, type PurchasedLabel, type RateRequest, type ShipmentParty, type TrackingSnapshot } from "./carrier.port";

const API = "https://api.goshippo.com";
const TIMEOUT_MS = 20_000;
const PLATFORM_NAME = "Global Fulfilment";

interface ShippoTransaction {
  object_id: string;
  status: string;
  rate?: string;
  tracking_number?: string;
  label_url?: string;
  tracking_url_provider?: string;
  messages?: Array<{ text?: string }>;
}

interface ShippoRate {
  object_id: string;
  amount: string;
  currency: string;
  provider: string;
  servicelevel?: { name?: string };
  estimated_days?: number | null;
}

interface ShippoTrackingEntry {
  status?: string;
  status_details?: string;
  status_date?: string;
  location?: { city?: string; country?: string } | null;
}

const TRACKING: Record<string, TrackingStatus | undefined> = { PRE_TRANSIT: "PRE_TRANSIT", TRANSIT: "IN_TRANSIT", DELIVERED: "DELIVERED", RETURNED: "RETURNED", FAILURE: "FAILURE" };

function address(party: ShipmentParty) {
  return {
    name: party.name,
    company: party.company ?? "",
    street1: party.line1,
    street2: party.line2 ?? "",
    city: party.city,
    state: party.region ?? "",
    zip: party.postalCode,
    country: party.countryCode,
    phone: party.phone ?? "",
    email: party.email ?? "",
  };
}

function trackingEvent(entry: ShippoTrackingEntry): CarrierTrackingEvent | null {
  const status = TRACKING[entry.status ?? ""];
  if (!status || !entry.status_date || Number.isNaN(Date.parse(entry.status_date))) {
    return null;
  }
  const place = [entry.location?.city, entry.location?.country].filter(Boolean).join(", ");
  return { status, description: (entry.status_details ?? status).slice(0, 500), occurredAt: new Date(entry.status_date).toISOString(), location: place ? place.slice(0, 120) : null };
}

export class ShippoCarrier implements CarrierAdapter {
  readonly provider = "SHIPPO" as const;

  constructor(private readonly apiKey: string) {}

  async quote(request: RateRequest): Promise<CarrierRate[]> {
    const shipment = await this.call<{ rates?: ShippoRate[]; messages?: Array<{ text?: string }> }>("POST", "/shipments/", {
      address_from: address(request.from),
      address_to: address(request.to),
      parcels: [
        {
          length: (request.parcel.lengthMm / 10).toFixed(1),
          width: (request.parcel.widthMm / 10).toFixed(1),
          height: (request.parcel.heightMm / 10).toFixed(1),
          distance_unit: "cm",
          weight: String(request.parcel.weightGrams),
          mass_unit: "g",
        },
      ],
      customs_declaration: request.customs ? this.customs(request) : undefined,
      metadata: `order:${request.reference}`,
      async: false,
    });
    return (shipment.rates ?? []).flatMap((rate) => {
      const costMinor = rate.currency === request.currency ? decimalToMinor(rate.amount, rate.currency) : null;
      return costMinor === null
        ? []
        : [
            {
              providerRateId: rate.object_id,
              carrier: rate.provider.slice(0, 60),
              carrierCode: carrierCodeFor(rate.provider),
              service: (rate.servicelevel?.name ?? "Standard").slice(0, 120),
              costMinor,
              currency: rate.currency,
              estimatedDays: rate.estimated_days ?? null,
            },
          ];
    });
  }

  async buyLabel(rate: LabelRate, reference: string): Promise<PurchasedLabel> {
    const transaction = await this.call<ShippoTransaction>("POST", "/transactions/", { rate: rate.providerRateId, label_file_type: "PDF_4x6", metadata: `order:${reference}`, async: false });
    if (transaction.status === "ERROR") {
      const reason = transaction.messages
        ?.map((message) => message.text)
        .filter(Boolean)
        .join("; ");
      throw new CarrierError(reason ? `The carrier refused the label: ${reason}` : "The carrier refused the label", true);
    }
    if (transaction.status !== "SUCCESS" || !transaction.tracking_number) {
      throw new CarrierError("The carrier hasn't confirmed the label yet.", false);
    }
    return this.label(rate, transaction);
  }

  async findLabel(rate: LabelRate): Promise<PurchasedLabel | null> {
    const page = await this.call<{ results?: ShippoTransaction[] }>("GET", "/transactions/?results=100");
    const match = (page.results ?? []).find((transaction) => transaction.rate === rate.providerRateId && transaction.status === "SUCCESS" && transaction.tracking_number);
    return match ? this.label(rate, match) : null;
  }

  async voidLabel(transactionId: string): Promise<boolean> {
    const refund = await this.call<{ status?: string }>("POST", "/refunds/", { transaction: transactionId, async: false });
    return refund.status !== "ERROR";
  }

  async track(carrier: string, trackingNumber: string): Promise<TrackingSnapshot> {
    const track = await this.call<{ tracking_history?: ShippoTrackingEntry[]; tracking_status?: ShippoTrackingEntry | null }>(
      "GET",
      `/tracks/${encodeURIComponent(carrier.toLowerCase())}/${encodeURIComponent(trackingNumber)}`,
    );
    const history = [...(track.tracking_history ?? []), ...(track.tracking_status ? [track.tracking_status] : [])];
    const events = history.map(trackingEvent).filter((event): event is CarrierTrackingEvent => event !== null);
    return { carrier, trackingNumber, events };
  }

  trackingTarget(body: unknown): { carrier: string; trackingNumber: string } | null {
    const data = (body as { event?: string; data?: { carrier?: unknown; tracking_number?: unknown } } | null)?.data;
    const event = (body as { event?: string } | null)?.event;
    if (event !== "track_updated" || typeof data?.carrier !== "string" || typeof data.tracking_number !== "string") {
      return null;
    }
    return /^[A-Za-z0-9_-]{2,40}$/.test(data.carrier) && /^[A-Za-z0-9-]{4,64}$/.test(data.tracking_number) ? { carrier: data.carrier, trackingNumber: data.tracking_number } : null;
  }

  private label(rate: LabelRate, transaction: ShippoTransaction): PurchasedLabel {
    return {
      transactionId: transaction.object_id,
      carrier: rate.carrier,
      carrierCode: rate.carrierCode,
      service: rate.service,
      trackingNumber: transaction.tracking_number!,
      labelUrl: transaction.label_url ?? null,
      trackingUrl: transaction.tracking_url_provider ?? null,
    };
  }

  private customs(request: RateRequest) {
    return {
      certify: true,
      certify_signer: PLATFORM_NAME,
      contents_type: "MERCHANDISE",
      non_delivery_option: "RETURN",
      incoterm: "DDU",
      items: (request.customs ?? []).map((item) => ({
        description: item.description.slice(0, 50),
        quantity: item.quantity,
        net_weight: String(item.netWeightGrams * item.quantity),
        mass_unit: "g",
        value_amount: minorToDecimal(item.unitValueMinor * item.quantity, request.currency),
        value_currency: request.currency,
        origin_country: item.originCountry,
        tariff_number: item.hsCode,
      })),
    };
  }

  private async call<T>(method: "GET" | "POST", path: string, body?: unknown): Promise<T> {
    let response: Response;
    try {
      response = await fetch(`${API}${path}`, {
        method,
        headers: { Authorization: `ShippoToken ${this.apiKey}`, "Content-Type": "application/json", Accept: "application/json" },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
    } catch {
      throw new CarrierError("The carrier didn't respond.", false);
    }
    if (response.status >= 400 && response.status < 500) {
      throw new CarrierError(response.status === 400 ? "The carrier couldn't use these details. Check the address and parcel." : "The carrier account refused the request.", true);
    }
    if (!response.ok) {
      throw new CarrierError("The carrier couldn't process this right now.", false);
    }
    return (await response.json()) as T;
  }
}
