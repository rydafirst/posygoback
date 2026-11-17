import { randomBytes } from "node:crypto";

import { Inject, Injectable } from "@nestjs/common";

import type { AuthPrincipal, RequestMeta } from "../../../common/auth/auth-principal";
import { Errors } from "../../../common/http/app-exception";
import { APP_CONFIG } from "../../../config/config.module";
import type { AppConfig } from "../../../config/config.schema";
import { lockRow, PrismaService } from "../../../database/prisma.service";
import type { StoreConnection, StoreDelivery } from "../../../generated/prisma/client";
import { AuditService } from "../../../infrastructure/audit/audit.service";
import { FieldEncryptionService } from "../../../infrastructure/crypto/field-encryption.service";
import { type CreateStoreConnectionInput, STORE_CONNECTION_LIMITS, type StoreConnectionCreatedView, type StoreConnectionView } from "../../../shared";
import { vendorIdOf } from "../../onboarding/scope";
import { VendorStandingService } from "../../onboarding/vendor-standing.service";

type ConnectionWithDeliveries = StoreConnection & { deliveries: StoreDelivery[] };

export function secretContext(connectionId: string): string {
  return `store_connection:${connectionId}`;
}

@Injectable()
export class StoreConnectionsService {
  private readonly apiUrl: string;

  constructor(
    private readonly prisma: PrismaService,
    private readonly standing: VendorStandingService,
    private readonly audit: AuditService,
    private readonly encryption: FieldEncryptionService,
    @Inject(APP_CONFIG) config: AppConfig,
  ) {
    this.apiUrl = config.API_PUBLIC_URL.replace(/\/$/, "");
  }

  async list(principal: AuthPrincipal): Promise<StoreConnectionView[]> {
    const rows = await this.prisma.storeConnection.findMany({
      where: { vendorId: vendorIdOf(principal) },
      include: { deliveries: { orderBy: { createdAt: "desc" }, take: STORE_CONNECTION_LIMITS.recentDeliveries } },
      orderBy: { createdAt: "desc" },
    });
    return rows.map((row) => this.view(row));
  }

  async create(principal: AuthPrincipal, input: CreateStoreConnectionInput, meta: RequestMeta): Promise<StoreConnectionCreatedView> {
    const vendor = await this.standing.assertCanTrade(principal);
    const secret = input.platform === "WOOCOMMERCE" ? randomBytes(24).toString("base64url") : null;
    const row = await this.prisma.$transaction(async (tx) => {
      await lockRow(tx, "vendors", vendor.vendorId);
      const active = await tx.storeConnection.count({ where: { vendorId: vendor.vendorId, revokedAt: null } });
      if (active >= STORE_CONNECTION_LIMITS.maxActivePerVendor) {
        throw Errors.invalidTransition(`You can connect up to ${STORE_CONNECTION_LIMITS.maxActivePerVendor} shops. Disconnect one first.`);
      }
      const created = await tx.storeConnection.create({
        data: { vendorId: vendor.vendorId, platform: input.platform, name: input.name, token: randomBytes(24).toString("base64url"), createdBy: principal.userId },
      });
      const stored = secret ? await tx.storeConnection.update({ where: { id: created.id }, data: { secretEncrypted: this.encryption.encrypt(secret, secretContext(created.id)) } }) : created;
      await this.audit.record(
        {
          actor: { userId: principal.userId, role: principal.role },
          action: "store_connection.created",
          resourceType: "store_connection",
          resourceId: created.id,
          vendorId: vendor.vendorId,
          after: { platform: input.platform, name: input.name },
          meta,
        },
        tx,
      );
      return stored;
    });
    return { ...this.view({ ...row, deliveries: [] }), secret };
  }

  async saveSigningSecret(principal: AuthPrincipal, id: string, secret: string, meta: RequestMeta): Promise<StoreConnectionView> {
    const vendorId = vendorIdOf(principal);
    const connection = await this.prisma.storeConnection.findFirst({ where: { id, vendorId, revokedAt: null } });
    if (!connection) {
      throw Errors.notFound();
    }
    if (connection.platform !== "SHOPIFY") {
      throw Errors.invalidTransition("Only Shopify shops need a signing key pasted in.");
    }
    const row = await this.prisma.$transaction(async (tx) => {
      const updated = await tx.storeConnection.update({
        where: { id },
        data: { secretEncrypted: this.encryption.encrypt(secret, secretContext(id)) },
        include: { deliveries: { orderBy: { createdAt: "desc" }, take: STORE_CONNECTION_LIMITS.recentDeliveries } },
      });
      await this.audit.record(
        { actor: { userId: principal.userId, role: principal.role }, action: "store_connection.secret_saved", resourceType: "store_connection", resourceId: id, vendorId, meta },
        tx,
      );
      return updated;
    });
    return this.view(row);
  }

  async disconnect(principal: AuthPrincipal, id: string, meta: RequestMeta): Promise<StoreConnectionView> {
    const vendorId = vendorIdOf(principal);
    const row = await this.prisma.$transaction(async (tx) => {
      const updated = await tx.storeConnection.updateMany({ where: { id, vendorId, revokedAt: null }, data: { revokedAt: new Date() } });
      const connection = await tx.storeConnection.findFirst({ where: { id, vendorId }, include: { deliveries: { orderBy: { createdAt: "desc" }, take: STORE_CONNECTION_LIMITS.recentDeliveries } } });
      if (!connection) {
        throw Errors.notFound();
      }
      if (updated.count > 0) {
        await this.audit.record(
          { actor: { userId: principal.userId, role: principal.role }, action: "store_connection.disconnected", resourceType: "store_connection", resourceId: id, vendorId, meta },
          tx,
        );
      }
      return connection;
    });
    return this.view(row);
  }

  private view(row: ConnectionWithDeliveries): StoreConnectionView {
    return {
      id: row.id,
      platform: row.platform,
      name: row.name,
      webhookUrl: `${this.apiUrl}/v1/integration/stores/${row.token}`,
      ready: row.secretEncrypted !== null && row.revokedAt === null,
      lastReceivedAt: row.lastReceivedAt?.toISOString() ?? null,
      revokedAt: row.revokedAt?.toISOString() ?? null,
      createdAt: row.createdAt.toISOString(),
      deliveries: row.deliveries.map((delivery) => ({
        externalReference: delivery.externalReference,
        outcome: delivery.outcome,
        message: delivery.message,
        orderReference: delivery.orderReference,
        createdAt: delivery.createdAt.toISOString(),
      })),
    };
  }
}
