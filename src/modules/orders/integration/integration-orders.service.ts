import { Injectable } from "@nestjs/common";

import { Errors } from "../../../common/http/app-exception";
import { PrismaService } from "../../../database/prisma.service";
import type { Order } from "../../../generated/prisma/client";
import type { IntegrationOrderInput, IntegrationOrderView } from "../../../shared";
import { VendorStandingService } from "../../onboarding/vendor-standing.service";
import { OrderCreationService } from "../core/order-creation.service";
import type { ApiClient } from "./api-keys.service";

@Injectable()
export class IntegrationOrdersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly creation: OrderCreationService,
    private readonly standing: VendorStandingService,
  ) {}

  async find(client: ApiClient, externalReference: string): Promise<IntegrationOrderView> {
    const order = await this.prisma.order.findFirst({ where: { vendorId: client.vendorId, externalReference } });
    if (!order) {
      throw Errors.notFound();
    }
    return this.view(order);
  }

  async place(client: ApiClient, input: IntegrationOrderInput): Promise<{ created: boolean; order: IntegrationOrderView }> {
    const existing = await this.prisma.order.findFirst({ where: { vendorId: client.vendorId, externalReference: input.externalReference } });
    if (existing) {
      return { created: false, order: this.view(existing) };
    }
    const vendor = await this.standing.assertVendorCanTrade(client.vendorId);
    const added = await this.prisma.vendorCountry.findUnique({ where: { vendorId_countryCode: { vendorId: client.vendorId, countryCode: input.country } } });
    if (!added) {
      throw Errors.validation({ country: ["You don't store stock in this country"] });
    }
    const codes = input.lines.map((line) => line.productCode);
    const products = await this.prisma.product.findMany({ where: { vendorId: client.vendorId, code: { in: codes }, status: "ACTIVE" }, select: { id: true, code: true } });
    const byCode = new Map(products.map((product) => [product.code, product.id]));
    const unknown = codes.filter((code) => !byCode.has(code));
    if (unknown.length > 0) {
      throw Errors.validation({ lines: [`Unknown product code ${unknown.join(", ")}`] });
    }
    try {
      const [id] = await this.creation.create(vendor, input.country, { userId: null, role: null, apiKeyId: client.apiKeyId }, "API", [
        { externalReference: input.externalReference, recipient: input.recipient, lines: input.lines.map((line) => ({ productId: byCode.get(line.productCode)!, quantity: line.quantity })) },
      ]);
      return { created: true, order: this.view(await this.prisma.order.findUniqueOrThrow({ where: { id: id! } })) };
    } catch (error) {
      const raced = await this.prisma.order.findFirst({ where: { vendorId: client.vendorId, externalReference: input.externalReference } });
      if (raced) {
        return { created: false, order: this.view(raced) };
      }
      throw error;
    }
  }

  private view(order: Order): IntegrationOrderView {
    return {
      reference: order.reference,
      externalReference: order.externalReference ?? "",
      status: order.status,
      carrier: order.carrier,
      trackingNumber: order.trackingNumber,
      trackingUrl: order.trackingUrl,
      createdAt: order.createdAt.toISOString(),
    };
  }
}
