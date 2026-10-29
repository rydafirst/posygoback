import { randomUUID } from "node:crypto";

import { Injectable } from "@nestjs/common";

import { Errors } from "../../../common/http/app-exception";
import { isUniqueViolation, PrismaService } from "../../../database/prisma.service";
import type { OrderSource, Prisma } from "../../../generated/prisma/client";
import { AuditService } from "../../../infrastructure/audit/audit.service";
import { type CountryConfig, type DeliveryPreference, fulfilmentFee, type OrderRecipient, prefixProblems, type Recipient, recipientProblems, type Role, unitsOf } from "../../../shared";
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
  deliveryPreference?: DeliveryPreference;
  recipient: OrderRecipient;
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

  async create(vendor: TradingVendor, countryCode: string, actor: OrderActor, source: OrderSource, deliveries: NewDelivery[], requestedWarehouseId?: string): Promise<string[]> {
    const country = await this.prisma.country.findUniqueOrThrow({ where: { code: countryCode }, select: { name: true, currency: true, config: true } });
    const recipients = this.recipientsIn(countryCode, country.name, (country.config as unknown as CountryConfig).address, deliveries);
    const products = await this.products(vendor.vendorId, deliveries);
    const warehouse = await this.warehouse(vendor, countryCode, deliveries, products, requestedWarehouseId);
    const active = await this.fees.active(countryCode);
    const { currency } = country;

    const postings: PostingResult[] = [];
    const ids = await this.insert(
      async (tx) => {
        const created: string[] = [];
        for (const [index, delivery] of deliveries.entries()) {
          const recipient = recipients[index]!;
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
              destinationCountryCode: warehouse.countryCode,
              source,
              externalReference: delivery.externalReference ?? null,
              deliveryPreference: delivery.deliveryPreference ?? "CHEAPEST",
              groupId: deliveries.length > 1 ? (created.length === 0 ? id : created[0]!) : id,
              recipientEncrypted: this.orders.encryptRecipient(id, recipient),
              recipientName: recipient.name,
              recipientCity: recipient.city,
              customsRequired: false,
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
              after: { reference, source, apiKeyId: actor.apiKeyId },
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

  private async warehouse(vendor: TradingVendor, countryCode: string, deliveries: NewDelivery[], products: Map<string, PreparedProduct>, requestedId?: string) {
    const needed = new Map<string, number>();
    for (const line of deliveries.flatMap((delivery) => delivery.lines)) {
      needed.set(line.productId, (needed.get(line.productId) ?? 0) + line.quantity);
    }
    const choice = await this.chooser.choose(vendor.vendorId, countryCode, needed, requestedId);
    if (choice.candidates === 0) {
      throw requestedId ? Errors.validation({ warehouseId: ["Choose a warehouse in this country"] }) : Errors.invalidTransition("There's no warehouse open in this country yet.");
    }
    if (!choice.warehouse) {
      throw Errors.insufficientStock(choice.shortProductIds.map((productId) => products.get(productId)!.name));
    }
    return choice.warehouse;
  }

  private recipientsIn(countryCode: string, countryName: string, rules: CountryConfig["address"], deliveries: NewDelivery[]): Recipient[] {
    const problems: Record<string, string[]> = {};
    const recipients = deliveries.map((delivery, index) => {
      if (delivery.recipient.countryCode && delivery.recipient.countryCode !== countryCode) {
        problems[`deliveries.${index}.recipient.countryCode`] = [`Use an address in ${countryName}`];
      }
      const recipient = { ...delivery.recipient, countryCode };
      Object.assign(problems, prefixProblems(recipientProblems(recipient, rules), `deliveries.${index}.recipient`));
      return recipient;
    });
    if (Object.keys(problems).length > 0) {
      throw Errors.validation(problems);
    }
    return recipients;
  }
}
