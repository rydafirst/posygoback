import { Injectable } from "@nestjs/common";

import { type DatabaseClient, PrismaService } from "../../../database/prisma.service";
import type { Prisma } from "../../../generated/prisma/client";
import { discountFor } from "../../../shared";

export type DiscountQuote = { ok: true; id: string; discountMinor: number } | { ok: false; problem: string };

@Injectable()
export class DiscountsService {
  constructor(private readonly prisma: PrismaService) {}

  async quote(vendorId: string, code: string, goodsMinor: number, client: DatabaseClient = this.prisma): Promise<DiscountQuote> {
    const now = new Date();
    const discount = await client.discountCode.findUnique({ where: { vendorId_code: { vendorId, code: code.trim().toUpperCase() } } });
    if (!discount || !discount.active || (discount.startsAt && discount.startsAt > now) || (discount.endsAt && discount.endsAt <= now)) {
      return { ok: false, problem: "That code isn't valid for this store" };
    }
    if (discount.maxRedemptions !== null && discount.redemptions >= discount.maxRedemptions) {
      return { ok: false, problem: "That code has been used up" };
    }
    if (goodsMinor < Number(discount.minGoodsMinor)) {
      return { ok: false, problem: "Add more to your basket to use this code" };
    }
    const discountMinor = discountFor({ kind: discount.kind, percentBps: discount.percentBps, amountMinor: discount.amountMinor === null ? null : Number(discount.amountMinor) }, goodsMinor);
    return { ok: true, id: discount.id, discountMinor };
  }

  async redeem(tx: Prisma.TransactionClient, discountCodeId: string): Promise<boolean> {
    const updated = await tx.$executeRaw`UPDATE discount_codes SET redemptions = redemptions + 1 WHERE id = ${discountCodeId}::uuid AND (max_redemptions IS NULL OR redemptions < max_redemptions)`;
    return updated > 0;
  }

  async release(tx: Prisma.TransactionClient, discountCodeId: string): Promise<void> {
    await tx.$executeRaw`UPDATE discount_codes SET redemptions = redemptions - 1 WHERE id = ${discountCodeId}::uuid AND redemptions > 0`;
  }
}
