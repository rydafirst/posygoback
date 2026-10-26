import { Injectable } from "@nestjs/common";

import type { AuthPrincipal, RequestMeta } from "../../../common/auth/auth-principal";
import { Errors } from "../../../common/http/app-exception";
import { lockRow, PrismaService } from "../../../database/prisma.service";
import type { Order, Prisma } from "../../../generated/prisma/client";
import { AuditService } from "../../../infrastructure/audit/audit.service";
import { orderValueMinor, partnerProgramme } from "../../../shared";
import { FilesService } from "../../files/files.service";
import { PartnerEarningsService, SHIPPED_ORDER_STATUSES } from "../../partners/ledger/partner-earnings.service";

const SHIPPED: readonly string[] = SHIPPED_ORDER_STATUSES;

@Injectable()
export class DispatchEvidenceService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly files: FilesService,
    private readonly earnings: PartnerEarningsService,
    private readonly audit: AuditService,
  ) {}

  async assertOwn(principal: AuthPrincipal, fileIds: string[]): Promise<void> {
    const statuses = await this.files.uploadedBy(principal.userId, fileIds, "EVIDENCE_PHOTO");
    if (fileIds.some((id) => statuses.get(id) !== "VERIFIED")) {
      throw Errors.validation({ photoFileIds: ["Upload each photo and wait for it to be checked"] });
    }
  }

  async record(tx: Prisma.TransactionClient, orderId: string, fileIds: string[], userId: string): Promise<void> {
    const taken = await tx.orderDispatchPhoto.count({ where: { fileId: { in: fileIds } } });
    const usedOnArrival = await tx.inboundPhoto.count({ where: { fileId: { in: fileIds } } });
    if (taken + usedOnArrival > 0) {
      throw Errors.validation({ photoFileIds: ["Each photo can only be used once"] });
    }
    await tx.orderDispatchPhoto.createMany({ data: fileIds.map((fileId) => ({ orderId, fileId, addedBy: userId })) });
  }

  async seal(tx: Prisma.TransactionClient, order: Order, sealNumber: string | undefined): Promise<string | null> {
    const [lines, country] = await Promise.all([
      tx.orderLine.findMany({ where: { orderId: order.id }, select: { quantity: true, unitValueMinor: true } }),
      tx.country.findUniqueOrThrow({ where: { code: order.originCountryCode }, select: { config: true } }),
    ]);
    if (!sealNumber && orderValueMinor(lines) >= partnerProgramme(country.config as { partners?: unknown }).highValueOrderMinor) {
      throw Errors.validation({ sealNumber: ["This parcel is high value. Close it with a numbered tamper seal and enter the number"] });
    }
    return sealNumber ?? null;
  }

  async shipped(tx: Prisma.TransactionClient, order: Order, fileIds: string[], userId: string): Promise<void> {
    if (fileIds.length > 0) {
      await this.record(tx, order.id, fileIds, userId);
    }
    await this.earnings.orderShipped(tx, order);
  }

  async add(principal: AuthPrincipal, orderId: string, fileIds: string[], scope: Prisma.OrderWhereInput, meta: RequestMeta): Promise<void> {
    const visible = await this.prisma.order.findFirst({ where: { id: orderId, ...scope }, select: { id: true } });
    if (!visible) {
      throw Errors.notFound();
    }
    await this.assertOwn(principal, fileIds);
    await this.prisma.$transaction(async (tx) => {
      await lockRow(tx, "orders", orderId);
      const order = await tx.order.findUniqueOrThrow({ where: { id: orderId } });
      if (!SHIPPED.includes(order.status) && order.status !== "LABEL_PURCHASED") {
        throw Errors.invalidTransition("Add dispatch photos once the label is bought.");
      }
      await this.record(tx, order.id, fileIds, principal.userId);
      if (SHIPPED.includes(order.status)) {
        await this.earnings.orderShipped(tx, order);
      }
      const actor = { userId: principal.userId, role: principal.role };
      await this.audit.record(
        {
          actor,
          action: "order.dispatch_photos_added",
          resourceType: "order",
          resourceId: orderId,
          vendorId: order.vendorId,
          countryCode: order.originCountryCode,
          after: { photos: fileIds.length },
          meta,
        },
        tx,
      );
    });
  }
}
