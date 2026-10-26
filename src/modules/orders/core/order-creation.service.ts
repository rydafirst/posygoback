import { randomUUID } from "node:crypto";

import { Injectable } from "@nestjs/common";

import { Errors } from "../../../common/http/app-exception";
import { isUniqueViolation, PrismaService } from "../../../database/prisma.service";
import type { OrderSource, Prisma } from "../../../generated/prisma/client";
import { AuditService } from "../../../infrastructure/audit/audit.service";
import { type CountryConfig, fulfilmentFee, prefixProblems, type Recipient, recipientProblems, type Role, unitsOf } from "../../../shared";
import { FeeSchedulesService } from "../../finance/fees/fee-schedules.service";
import { WalletAlertsService } from "../../finance/wallets/wallet-alerts.service";
import type { PostingResult } from "../../finance/wallets/wallet-ledger.service";
import type { TradingVendor } from "../../onboarding/vendor-standing.service";
import { OrderChargesService } from "./order-charges.service";
import { orderReference } from "./order-references";
import { OrderTimelineService } from "./order-timeline.service";
import { OrdersRepository } from "./orders.repository";
import { StockAllocationService } from "./stock-allocation.service";
import { WarehouseChooserService } from "./warehouse-chooser.service";

export interface OrderActor {
  userId: string | null;
  role: Role | null;
  apiKeyId: string | null;
}

export interface NewDelivery {
  externalReference?: string;
  recipient: Recipient;
  lines: Array<{ productId: string; quantity: number }>;
}

interface PreparedProduct {
  id: string;
  code: string;
  name: string;
  declaredValueMinor: number;
  weightGrams: number;
  hsCode: string | null;
  countryOfOrigin: string;
}

const SOURCE_LABEL: Record<OrderSource, string> = { PORTAL: "the portal", CSV: "a spreadsheet import", API: "the API", STOREFRONT: "the storefront" };

@Injectable()
export class OrderCreationService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly orders: OrdersRepository,
    private readonly fees: FeeSchedulesService,
    private readonly charges: OrderChargesService,
    private readonly allocation: StockAllocationService,
    private readonly chooser: WarehouseChooserService,
    private readonly timeline: OrderTimelineService,
    private readonly alerts: WalletAlertsService,
    private readonly audit: AuditService,
  ) {}

  async create(vendor: TradingVendor, actor: OrderActor, source: OrderSource, deliveries: NewDelivery[], requestedWarehouseId?: string): Promise<string[]> {
    const products = await this.products(vendor.vendorId, deliveries);
    const warehouse = await this.warehouse(vendor, deliveries, products, requestedWarehouseId);
    const destinations = await this.destinations(warehouse.countryCode, deliveries);
    const active = await this.fees.active(warehouse.countryCode);
    const currency = (await this.prisma.country.findUniqueOrThrow({ where: { code: warehouse.countryCode }, select: { currency: true } })).currency;
    const problems: Record<string, string[]> = {};
    deliveries.forEach((delivery, index) => {
      const destination = destinations.get(delivery.recipient.countryCode)!;
      Object.assign(problems, prefixProblems(recipientProblems(delivery.recipient, destination.config.address, destination.customsRequired), `deliveries.${index}.recipient`));
      const missingHs = destination.customsRequired ? delivery.lines.map((line) => products.get(line.productId)!).filter((product) => !product.hsCode) : [];
      if (missingHs.length > 0) {
        problems[`deliveries.${index}.lines`] = [`Add an HS code to ${missingHs.map((product) => product.name).join(", ")} before sending it abroad`];
      }
    });
    if (Object.keys(problems).length > 0) {
      throw Errors.validation(problems);
    }

    const postings: PostingResult[] = [];
    const ids = await this.insert(
      async (tx) => {
        const created: string[] = [];
        for (const delivery of deliveries) {
          const id = randomUUID();
          const reference = orderReference(warehouse.countryCode);
          const feeMinor = fulfilmentFee(active.schedule, unitsOf(delivery.lines));
          const order = await tx.order.create({
            data: {
              id,
              reference,
              vendorId: vendor.vendorId,
              warehouseId: warehouse.id,
              originCountryCode: warehouse.countryCode,
              destinationCountryCode: delivery.recipient.countryCode,
              source,
              externalReference: delivery.externalReference ?? null,
              groupId: deliveries.length > 1 ? (created.length === 0 ? id : created[0]!) : id,
              recipientEncrypted: this.orders.encryptRecipient(id, delivery.recipient),
              recipientName: delivery.recipient.name,
              recipientCity: delivery.recipient.city,
              customsRequired: destinations.get(delivery.recipient.countryCode)!.customsRequired,
              currency,
              feeScheduleId: active.id,
              fulfilmentFeeMinor: BigInt(feeMinor),
              createdBy: actor.userId,
              apiKeyId: actor.apiKeyId,
              lines: {
                create: delivery.lines.map((line) => {
                  const product = products.get(line.productId)!;
                  return {
                    productId: product.id,
                    productCode: product.code,
                    productName: product.name,
                    quantity: line.quantity,
                    unitValueMinor: product.declaredValueMinor,
                    unitWeightGrams: product.weightGrams,
                    hsCode: product.hsCode,
                    countryOfOrigin: product.countryOfOrigin,
                  };
                }),
              },
            },
            include: { lines: true },
          });
          await this.allocation.reserve(
            tx,
            { id, vendorId: vendor.vendorId, warehouseId: warehouse.id },
            order.lines.map((line) => ({ lineId: line.id, productId: line.productId, productName: line.productName, quantity: line.quantity })),
            actor.userId,
          );
          const posting = await this.charges.chargeFulfilment(tx, { id, reference, vendorId: vendor.vendorId, currency }, feeMinor, actor.userId);
          if (posting) {
            postings.push(posting);
          }
          await this.timeline.add(tx, id, {
            type: "order.created",
            description: `Order placed through ${SOURCE_LABEL[source]}`,
            source: actor.userId || actor.apiKeyId ? "VENDOR" : "SYSTEM",
            actorId: actor.userId,
          });
          await this.audit.record(
            {
              actor: { userId: actor.userId, role: actor.role },
              action: "order.created",
              resourceType: "order",
              resourceId: id,
              vendorId: vendor.vendorId,
              countryCode: warehouse.countryCode,
              after: { reference, source, destination: delivery.recipient.countryCode, apiKeyId: actor.apiKeyId },
            },
            tx,
          );
          created.push(id);
        }
        return created;
      },
      vendor.vendorId,
      deliveries,
    );
    for (const posting of postings) {
      await this.alerts.afterPosting(posting);
    }
    return ids;
  }

  private async insert(work: (tx: Prisma.TransactionClient) => Promise<string[]>, vendorId: string, deliveries: NewDelivery[]): Promise<string[]> {
    try {
      return await this.prisma.$transaction(work);
    } catch (error) {
      if (!isUniqueViolation(error)) {
        throw error;
      }
      const references = deliveries.map((delivery) => delivery.externalReference).filter((reference): reference is string => Boolean(reference));
      const taken = references.length > 0 ? await this.prisma.order.findFirst({ where: { vendorId, externalReference: { in: references } }, select: { externalReference: true } }) : null;
      if (!taken) {
        throw Errors.invalidTransition("The order couldn't be saved. Try again.");
      }
      const index = deliveries.findIndex((delivery) => delivery.externalReference === taken.externalReference);
      throw Errors.validation({ [`deliveries.${index}.externalReference`]: ["You've already used this reference for another order"] });
    }
  }

  private async products(vendorId: string, deliveries: NewDelivery[]): Promise<Map<string, PreparedProduct>> {
    const ids = [...new Set(deliveries.flatMap((delivery) => delivery.lines.map((line) => line.productId)))];
    const rows = await this.prisma.product.findMany({ where: { vendorId, id: { in: ids }, status: "ACTIVE" } });
    const found = new Map(rows.map((row) => [row.id, row]));
    const problems: Record<string, string[]> = {};
    deliveries.forEach((delivery, index) => {
      if (delivery.lines.some((line) => !found.has(line.productId))) {
        problems[`deliveries.${index}.lines`] = ["One of these products isn't in your catalogue"];
      }
    });
    if (Object.keys(problems).length > 0) {
      throw Errors.validation(problems);
    }
    return found;
  }

  private async warehouse(vendor: TradingVendor, deliveries: NewDelivery[], products: Map<string, PreparedProduct>, requestedId?: string) {
    const needed = new Map<string, number>();
    for (const line of deliveries.flatMap((delivery) => delivery.lines)) {
      needed.set(line.productId, (needed.get(line.productId) ?? 0) + line.quantity);
    }
    const choice = await this.chooser.choose(vendor.vendorId, vendor.countryCode, needed, requestedId);
    if (choice.candidates === 0) {
      throw requestedId ? Errors.validation({ warehouseId: ["Choose one of your market's warehouses"] }) : Errors.invalidTransition("There's no warehouse open in your market yet.");
    }
    if (!choice.warehouse) {
      throw Errors.insufficientStock(choice.shortProductIds.map((productId) => products.get(productId)!.name));
    }
    return choice.warehouse;
  }

  private async destinations(originCountryCode: string, deliveries: NewDelivery[]) {
    const codes = [...new Set(deliveries.map((delivery) => delivery.recipient.countryCode))];
    const lanes = await this.prisma.shippingLane.findMany({
      where: { originCountryCode, destinationCountryCode: { in: codes }, enabled: true },
      include: { destination: { select: { config: true } } },
    });
    const byCode = new Map(lanes.map((lane) => [lane.destinationCountryCode, { customsRequired: lane.customsRequired, config: lane.destination.config as unknown as CountryConfig }]));
    const problems: Record<string, string[]> = {};
    deliveries.forEach((delivery, index) => {
      if (!byCode.has(delivery.recipient.countryCode)) {
        problems[`deliveries.${index}.recipient.countryCode`] = [`We don't ship from ${originCountryCode} to ${delivery.recipient.countryCode} yet`];
      }
    });
    if (Object.keys(problems).length > 0) {
      throw Errors.validation(problems);
    }
    return byCode;
  }
}
