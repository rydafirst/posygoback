import { Injectable } from "@nestjs/common";

import type { AuthPrincipal, RequestMeta } from "../../../common/auth/auth-principal";
import { Errors } from "../../../common/http/app-exception";
import { isUniqueViolation, PrismaService } from "../../../database/prisma.service";
import type { DiscountCode } from "../../../generated/prisma/client";
import { AuditService } from "../../../infrastructure/audit/audit.service";
import type { DiscountCodeInput, DiscountCodeView } from "../../../shared";
import { vendorIdOf } from "../../onboarding/scope";

const MAX_CODES = 200;

function view(row: DiscountCode): DiscountCodeView {
  return {
    id: row.id,
    code: row.code,
    kind: row.kind,
    percentBps: row.percentBps,
    amountMinor: row.amountMinor === null ? null : Number(row.amountMinor),
    minGoodsMinor: Number(row.minGoodsMinor),
    startsAt: row.startsAt?.toISOString() ?? null,
    endsAt: row.endsAt?.toISOString() ?? null,
    maxRedemptions: row.maxRedemptions,
    redemptions: row.redemptions,
    active: row.active,
    createdAt: row.createdAt.toISOString(),
  };
}

@Injectable()
export class DiscountCodesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async list(principal: AuthPrincipal): Promise<DiscountCodeView[]> {
    const rows = await this.prisma.discountCode.findMany({ where: { vendorId: vendorIdOf(principal) }, orderBy: [{ active: "desc" }, { createdAt: "desc" }], take: MAX_CODES });
    return rows.map(view);
  }

  async create(principal: AuthPrincipal, input: DiscountCodeInput, meta: RequestMeta): Promise<DiscountCodeView> {
    const vendorId = vendorIdOf(principal);
    if ((await this.prisma.discountCode.count({ where: { vendorId } })) >= MAX_CODES) {
      throw Errors.invalidTransition("You've reached the limit of discount codes. Switch off old ones you no longer need.");
    }
    try {
      const created = await this.prisma.discountCode.create({
        data: {
          vendorId,
          code: input.code,
          kind: input.kind,
          percentBps: input.kind === "PERCENT" ? input.percentBps! : null,
          amountMinor: input.kind === "FIXED" ? BigInt(input.amountMinor!) : null,
          minGoodsMinor: BigInt(input.minGoodsMinor),
          startsAt: input.startsAt ? new Date(input.startsAt) : null,
          endsAt: input.endsAt ? new Date(input.endsAt) : null,
          maxRedemptions: input.maxRedemptions ?? null,
          createdBy: principal.userId,
        },
      });
      await this.audit.record({
        actor: { userId: principal.userId, role: principal.role },
        action: "storefront.discount_created",
        resourceType: "discount_code",
        resourceId: created.id,
        vendorId,
        after: { code: created.code },
        meta,
      });
      return view(created);
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw Errors.validation({ code: ["You already have a code with that name"] });
      }
      throw error;
    }
  }

  async setActive(principal: AuthPrincipal, codeId: string, active: boolean, meta: RequestMeta): Promise<DiscountCodeView> {
    const vendorId = vendorIdOf(principal);
    const updated = await this.prisma.discountCode.updateMany({ where: { id: codeId, vendorId }, data: { active } });
    if (updated.count === 0) {
      throw Errors.notFound();
    }
    await this.audit.record({
      actor: { userId: principal.userId, role: principal.role },
      action: active ? "storefront.discount_enabled" : "storefront.discount_disabled",
      resourceType: "discount_code",
      resourceId: codeId,
      vendorId,
      meta,
    });
    return view(await this.prisma.discountCode.findUniqueOrThrow({ where: { id: codeId } }));
  }
}
