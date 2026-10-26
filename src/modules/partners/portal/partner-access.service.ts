import { Injectable } from "@nestjs/common";

import type { AuthPrincipal } from "../../../common/auth/auth-principal";
import { Errors } from "../../../common/http/app-exception";
import { lockRow, PrismaService } from "../../../database/prisma.service";
import type { FulfilmentPartner, Prisma } from "../../../generated/prisma/client";
import type { PartnerStatus } from "../../../shared";

export const OPEN_PARTNER_STATUSES: readonly PartnerStatus[] = ["APPLIED", "VERIFYING", "UNDER_REVIEW", "ACTIVE", "SUSPENDED", "OFFBOARDING"];

export function partnerIdOf(principal: AuthPrincipal): string {
  if (!principal.partnerId) {
    throw Errors.notFound();
  }
  return principal.partnerId;
}

@Injectable()
export class PartnerAccessService {
  constructor(private readonly prisma: PrismaService) {}

  current(principal: AuthPrincipal): Promise<FulfilmentPartner> {
    return this.prisma.fulfilmentPartner.findUniqueOrThrow({ where: { id: partnerIdOf(principal) } });
  }

  async mutate<Result>(
    principal: AuthPrincipal,
    allowed: readonly PartnerStatus[],
    refusal: string,
    work: (tx: Prisma.TransactionClient, partner: FulfilmentPartner) => Promise<Result>,
  ): Promise<Result> {
    const partnerId = partnerIdOf(principal);
    return this.prisma.$transaction(async (tx) => {
      await lockRow(tx, "fulfilmentPartners", partnerId);
      const partner = await tx.fulfilmentPartner.findUniqueOrThrow({ where: { id: partnerId } });
      if (!allowed.includes(partner.status)) {
        throw Errors.invalidTransition(refusal);
      }
      return work(tx, partner);
    });
  }
}
