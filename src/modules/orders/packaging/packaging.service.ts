import { Injectable } from "@nestjs/common";

import type { AuthPrincipal, RequestMeta } from "../../../common/auth/auth-principal";
import { Errors } from "../../../common/http/app-exception";
import { isUniqueViolation, PrismaService } from "../../../database/prisma.service";
import type { PackagingPreset } from "../../../generated/prisma/client";
import { AuditService } from "../../../infrastructure/audit/audit.service";
import type { PackagingPresetInput, PackagingPresetView } from "../../../shared";
import { warehouseCountryScope } from "../../stock/scope";

function view(row: PackagingPreset): PackagingPresetView {
  return { id: row.id, countryCode: row.countryCode, code: row.code, label: row.label, kind: row.kind, lengthMm: row.lengthMm, widthMm: row.widthMm, heightMm: row.heightMm, active: row.active };
}

@Injectable()
export class PackagingService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async list(principal: AuthPrincipal, countryCode: string): Promise<PackagingPresetView[]> {
    const scope = warehouseCountryScope(principal);
    if (scope && scope !== countryCode) {
      throw Errors.notFound();
    }
    const rows = await this.prisma.packagingPreset.findMany({ where: { countryCode }, orderBy: [{ active: "desc" }, { kind: "asc" }, { lengthMm: "asc" }] });
    return rows.map(view);
  }

  async create(principal: AuthPrincipal, countryCode: string, input: PackagingPresetInput, meta: RequestMeta): Promise<PackagingPresetView> {
    if (!(await this.prisma.country.findUnique({ where: { code: countryCode } }))) {
      throw Errors.notFound();
    }
    return this.save(principal, meta, "packaging.created", () => this.prisma.packagingPreset.create({ data: { countryCode, ...input } }));
  }

  async update(principal: AuthPrincipal, id: string, input: PackagingPresetInput, meta: RequestMeta): Promise<PackagingPresetView> {
    if (!(await this.prisma.packagingPreset.findUnique({ where: { id } }))) {
      throw Errors.notFound();
    }
    return this.save(principal, meta, "packaging.updated", () => this.prisma.packagingPreset.update({ where: { id }, data: input }));
  }

  private async save(principal: AuthPrincipal, meta: RequestMeta, action: string, write: () => Promise<PackagingPreset>): Promise<PackagingPresetView> {
    let row: PackagingPreset;
    try {
      row = await write();
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw Errors.validation({ code: ["Another package in this country already uses that code"] });
      }
      throw error;
    }
    await this.audit.record({
      actor: { userId: principal.userId, role: principal.role },
      action,
      resourceType: "packaging_preset",
      resourceId: row.id,
      countryCode: row.countryCode,
      after: view(row),
      meta,
    });
    return view(row);
  }
}
