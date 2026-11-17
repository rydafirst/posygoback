import { Injectable, Logger } from "@nestjs/common";

import { AppException } from "../../../common/http/app-exception";
import { PrismaService } from "../../../database/prisma.service";
import type { StoreConnection, StoreDeliveryOutcome } from "../../../generated/prisma/client";
import { FieldEncryptionService } from "../../../infrastructure/crypto/field-encryption.service";
import { IntegrationOrdersService } from "./integration-orders.service";
import { secretContext } from "./store-connections.service";
import { mapStoreOrder } from "./store-order-mapper";
import { signatureHeader, signatureMatches } from "./store-signatures";

export type StoreWebhookResult = "accepted" | "unknown" | "unsigned";

type Headers = Record<string, string | string[] | undefined>;

const MESSAGE_LIMIT = 300;

@Injectable()
export class StoreWebhooksService {
  private readonly logger = new Logger(StoreWebhooksService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly encryption: FieldEncryptionService,
    private readonly orders: IntegrationOrdersService,
  ) {}

  async receive(token: string, rawBody: Buffer, headers: Headers): Promise<StoreWebhookResult> {
    const connection = await this.prisma.storeConnection.findUnique({ where: { token } });
    if (!connection || connection.revokedAt) {
      return "unknown";
    }
    const payload = this.parse(rawBody);
    if (payload === null) {
      return "accepted";
    }
    if (!connection.secretEncrypted) {
      await this.record(
        connection,
        null,
        "FAILED",
        "An order arrived before the Shopify signing key was saved. Paste the key here and Shopify will send the order again automatically within a few hours.",
      );
      return "unsigned";
    }
    const presented = headers[signatureHeader(connection.platform)];
    const secret = this.encryption.decrypt(connection.secretEncrypted, secretContext(connection.id));
    if (!signatureMatches(rawBody, secret, typeof presented === "string" ? presented : undefined)) {
      await this.record(connection, null, "FAILED", "A message arrived with the wrong signature, so it was ignored. Check the signing key matches your store.");
      return "unsigned";
    }
    await this.process(connection, payload);
    return "accepted";
  }

  private async process(connection: StoreConnection, payload: unknown): Promise<void> {
    const mapped = mapStoreOrder(connection.platform, payload);
    if (mapped.kind === "skip") {
      await this.record(connection, mapped.externalReference, "SKIPPED", mapped.reason);
      return;
    }
    try {
      const placed = await this.orders.placeFor(connection.vendorId, mapped.order, null, connection.platform);
      await this.record(
        connection,
        mapped.order.externalReference,
        placed.created ? "CREATED" : "DUPLICATE",
        placed.created ? `Order ${placed.order.reference} created. The hub will pack it.` : `Already received as ${placed.order.reference}.`,
        placed.order.reference,
      );
    } catch (error) {
      await this.record(connection, mapped.order.externalReference, "FAILED", this.reason(error));
    }
  }

  private reason(error: unknown): string {
    if (error instanceof AppException) {
      const fields = error.fieldErrors ? Object.values(error.fieldErrors).flat() : [];
      return [error.message === "Some fields need attention." ? null : error.message, ...fields].filter(Boolean).join(" ") || "The order couldn't be created.";
    }
    this.logger.error(error);
    return "Something went wrong on our side. We've been told and will follow up.";
  }

  private parse(rawBody: Buffer): unknown {
    try {
      const parsed: unknown = JSON.parse(rawBody.toString("utf8"));
      return parsed !== null && typeof parsed === "object" ? parsed : null;
    } catch {
      return null;
    }
  }

  private async record(connection: StoreConnection, externalReference: string | null, outcome: StoreDeliveryOutcome, message: string, orderReference?: string): Promise<void> {
    await this.prisma.$transaction([
      this.prisma.storeDelivery.create({ data: { connectionId: connection.id, externalReference, outcome, message: message.slice(0, MESSAGE_LIMIT), orderReference: orderReference ?? null } }),
      this.prisma.storeConnection.update({ where: { id: connection.id }, data: { lastReceivedAt: new Date() } }),
    ]);
  }
}
