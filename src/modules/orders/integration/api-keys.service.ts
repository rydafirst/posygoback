import { Inject, Injectable } from "@nestjs/common";

import type { AuthPrincipal, RequestMeta } from "../../../common/auth/auth-principal";
import { Errors } from "../../../common/http/app-exception";
import { APP_CONFIG } from "../../../config/config.module";
import type { AppConfig } from "../../../config/config.schema";
import { lockRow, PrismaService } from "../../../database/prisma.service";
import type { ApiKey } from "../../../generated/prisma/client";
import { AuditService } from "../../../infrastructure/audit/audit.service";
import { API_KEY_LIMITS, type ApiKeyCreatedView, type ApiKeyView } from "../../../shared";
import { vendorIdOf } from "../../onboarding/scope";
import { VendorStandingService } from "../../onboarding/vendor-standing.service";
import { hashSecret, keyPrefix, newApiKey, parseApiKey, secretMatches } from "./api-key";

const LAST_USED_RESOLUTION_MS = 60_000;

export interface ApiClient {
  keyId: string;
  apiKeyId: string;
  vendorId: string;
}

@Injectable()
export class ApiKeysService {
  private readonly live: boolean;

  constructor(
    private readonly prisma: PrismaService,
    private readonly standing: VendorStandingService,
    private readonly audit: AuditService,
    @Inject(APP_CONFIG) config: AppConfig,
  ) {
    this.live = config.NODE_ENV === "production";
  }

  async list(principal: AuthPrincipal): Promise<ApiKeyView[]> {
    const rows = await this.prisma.apiKey.findMany({ where: { vendorId: vendorIdOf(principal) }, orderBy: { createdAt: "desc" } });
    return rows.map((row) => this.view(row));
  }

  async create(principal: AuthPrincipal, name: string, meta: RequestMeta): Promise<ApiKeyCreatedView> {
    const vendor = await this.standing.assertCanTrade(principal);
    const generated = newApiKey(this.live);
    const row = await this.prisma.$transaction(async (tx) => {
      await lockRow(tx, "vendors", vendor.vendorId);
      const active = await tx.apiKey.count({ where: { vendorId: vendor.vendorId, revokedAt: null } });
      if (active >= API_KEY_LIMITS.maxActivePerVendor) {
        throw Errors.invalidTransition(`You can have up to ${API_KEY_LIMITS.maxActivePerVendor} active keys. Revoke one first.`);
      }
      const created = await tx.apiKey.create({ data: { vendorId: vendor.vendorId, name, keyId: generated.keyId, secretHash: hashSecret(generated.secret), createdBy: principal.userId } });
      await this.audit.record(
        {
          actor: { userId: principal.userId, role: principal.role },
          action: "api_key.created",
          resourceType: "api_key",
          resourceId: created.id,
          vendorId: vendor.vendorId,
          after: { name, prefix: generated.prefix },
          meta,
        },
        tx,
      );
      return created;
    });
    return { ...this.view(row), key: generated.key };
  }

  async revoke(principal: AuthPrincipal, id: string, meta: RequestMeta): Promise<ApiKeyView> {
    const vendorId = vendorIdOf(principal);
    const row = await this.prisma.$transaction(async (tx) => {
      const updated = await tx.apiKey.updateMany({ where: { id, vendorId, revokedAt: null }, data: { revokedAt: new Date() } });
      const key = await tx.apiKey.findFirst({ where: { id, vendorId } });
      if (!key) {
        throw Errors.notFound();
      }
      if (updated.count > 0) {
        await this.audit.record({ actor: { userId: principal.userId, role: principal.role }, action: "api_key.revoked", resourceType: "api_key", resourceId: id, vendorId, meta }, tx);
      }
      return key;
    });
    return this.view(row);
  }

  async authenticate(presented: string | undefined): Promise<ApiClient | null> {
    const parsed = parseApiKey(presented);
    if (!parsed) {
      return null;
    }
    const key = await this.prisma.apiKey.findUnique({ where: { keyId: parsed.keyId }, include: { vendor: { select: { status: true } } } });
    if (!key || key.revokedAt || !secretMatches(parsed.secret, key.secretHash) || key.vendor.status !== "ACTIVE") {
      return null;
    }
    if (!key.lastUsedAt || Date.now() - key.lastUsedAt.getTime() > LAST_USED_RESOLUTION_MS) {
      await this.prisma.apiKey.update({ where: { id: key.id }, data: { lastUsedAt: new Date() } });
    }
    return { keyId: key.keyId, apiKeyId: key.id, vendorId: key.vendorId };
  }

  private view(row: ApiKey): ApiKeyView {
    return {
      id: row.id,
      name: row.name,
      prefix: keyPrefix(row.keyId, this.live),
      createdAt: row.createdAt.toISOString(),
      lastUsedAt: row.lastUsedAt?.toISOString() ?? null,
      revokedAt: row.revokedAt?.toISOString() ?? null,
    };
  }
}
