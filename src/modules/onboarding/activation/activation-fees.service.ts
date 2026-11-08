import { Injectable } from "@nestjs/common";

import type { AuthPrincipal, RequestMeta } from "../../../common/auth/auth-principal";
import { Errors } from "../../../common/http/app-exception";
import { PrismaService } from "../../../database/prisma.service";
import type { Prisma } from "../../../generated/prisma/client";
import { AuditService } from "../../../infrastructure/audit/audit.service";
import { type ActivationFeeInput, type ActivationFeeView, hasPermission } from "../../../shared";
import { VendorActivationService } from "../vendor-activation.service";
import { ActivationFeeRepository } from "./activation-fee.repository";
import { ActivationNoticesService } from "./activation-notices.service";

@Injectable()
export class ActivationFeesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly fees: ActivationFeeRepository,
    private readonly activation: VendorActivationService,
    private readonly notices: ActivationNoticesService,
    private readonly audit: AuditService,
  ) {}

  current(): Promise<ActivationFeeView> {
    return this.fees.current();
  }

  async set(input: ActivationFeeInput, principal: AuthPrincipal, meta: RequestMeta): Promise<ActivationFeeView> {
    if (!hasPermission(principal.role, "countries.manage")) {
      throw Errors.forbidden("Only a super admin can change the activation fee.");
    }
    const { fee, liveNow } = await this.prisma.$transaction(async (tx) => {
      const before = await this.fees.current(tx);
      const updated = await this.fees.update(input.activationFeeMinor, tx);
      if (before.feeMinor !== updated.feeMinor) {
        await this.audit.record(
          {
            actor: { userId: principal.userId, role: principal.role },
            action: "platform.activation_fee_changed",
            resourceType: "platform_setting",
            resourceId: "activation_fee",
            before: { ...before },
            after: { ...updated },
            meta,
          },
          tx,
        );
      }
      return { fee: updated, liveNow: updated.feeMinor === 0 ? await this.releaseWaiting(tx) : [] };
    });
    for (const vendorId of liveNow) {
      await this.notices.waived(vendorId);
    }
    return fee;
  }

  private async releaseWaiting(tx: Prisma.TransactionClient): Promise<string[]> {
    const waiting = await tx.vendor.findMany({ where: { status: "PENDING_VERIFICATION", activationDueAt: { not: null } }, select: { id: true, countryCode: true } });
    const released: string[] = [];
    for (const { id, countryCode } of waiting) {
      if (await this.activation.goLive(id, countryCode, tx, { feeMinor: 0, reason: "activation fee removed" })) {
        released.push(id);
      }
    }
    return released;
  }
}
