import { Inject, Injectable, Logger } from "@nestjs/common";

import type { AuthPrincipal, RequestMeta } from "../../common/auth/auth-principal";
import { Errors } from "../../common/http/app-exception";
import { lockRow, PrismaService } from "../../database/prisma.service";
import { Prisma } from "../../generated/prisma/client";
import { AuditService } from "../../infrastructure/audit/audit.service";
import { OBJECT_STORAGE, type ObjectStorage } from "../files/storage/object-storage.port";
import { partnerHasHistory, vendorHasHistory } from "./account-history";

const VENDOR_HAS_HISTORY = "This business has orders, stock or payments on record, so it can't be deleted. Deactivate it instead.";
const PARTNER_HAS_HISTORY = "This partner has run a hub or has money on record, so it can't be deleted. Deactivate it instead.";

@Injectable()
export class AccountRemovalService {
  private readonly logger = new Logger(AccountRemovalService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    @Inject(OBJECT_STORAGE) private readonly storage: ObjectStorage,
  ) {}

  async deleteVendor(principal: AuthPrincipal, vendorId: string, reason: string, meta: RequestMeta): Promise<void> {
    const objectKeys = await this.removing(VENDOR_HAS_HISTORY, (tx) => this.removeVendor(tx, principal, vendorId, reason, meta));
    await this.removeObjects(objectKeys);
  }

  async deletePartner(principal: AuthPrincipal, partnerId: string, reason: string, meta: RequestMeta): Promise<void> {
    const objectKeys = await this.removing(PARTNER_HAS_HISTORY, (tx) => this.removePartner(tx, principal, partnerId, reason, meta));
    await this.removeObjects(objectKeys);
  }

  private async removeVendor(tx: Prisma.TransactionClient, principal: AuthPrincipal, vendorId: string, reason: string, meta: RequestMeta): Promise<string[]> {
    if (!(await lockRow(tx, "vendors", vendorId))) {
      throw Errors.notFound();
    }
    if (await vendorHasHistory(tx, vendorId)) {
      throw Errors.invalidTransition(VENDOR_HAS_HISTORY);
    }
    const vendor = await tx.vendor.findUniqueOrThrow({ where: { id: vendorId }, include: { users: { select: { id: true, email: true } } } });
    const userIds = vendor.users.map((user) => user.id);
    const files = await tx.storedFile.findMany({ where: { OR: [{ vendorId }, { ownerUserId: { in: userIds } }] }, select: { id: true, objectKey: true } });
    const owned = { vendorId };
    await tx.identityCheck.deleteMany({ where: { subjectId: { in: [vendorId, ...userIds] } } });
    await tx.productBarcode.deleteMany({ where: owned });
    await tx.product.deleteMany({ where: owned });
    await tx.discountCode.deleteMany({ where: owned });
    await tx.storefront.deleteMany({ where: owned });
    await tx.vendorPayoutAccount.deleteMany({ where: owned });
    await tx.apiKey.deleteMany({ where: owned });
    await tx.orderImportBatch.deleteMany({ where: owned });
    await tx.vendorActivationPayment.deleteMany({ where: owned });
    await tx.topUp.deleteMany({ where: owned });
    await tx.walletAdjustment.deleteMany({ where: { wallet: owned } });
    await tx.wallet.deleteMany({ where: owned });
    await tx.vendorVerification.deleteMany({ where: owned });
    await tx.agreementAcceptance.deleteMany({ where: owned });
    await tx.vendorInvitation.deleteMany({ where: owned });
    await tx.storedFile.deleteMany({ where: { id: { in: files.map((file) => file.id) } } });
    await tx.user.deleteMany({ where: owned });
    await tx.vendor.delete({ where: { id: vendorId } });
    await this.audit.record(
      {
        actor: { userId: principal.userId, role: principal.role },
        action: "vendor.deleted",
        resourceType: "vendor",
        resourceId: vendorId,
        countryCode: vendor.countryCode,
        before: { businessName: vendor.businessName, members: vendor.users.map((user) => user.email) },
        after: { reason },
        meta,
      },
      tx,
    );
    return files.map((file) => file.objectKey);
  }

  private async removePartner(tx: Prisma.TransactionClient, principal: AuthPrincipal, partnerId: string, reason: string, meta: RequestMeta): Promise<string[]> {
    if (!(await lockRow(tx, "fulfilmentPartners", partnerId))) {
      throw Errors.notFound();
    }
    if (await partnerHasHistory(tx, partnerId)) {
      throw Errors.invalidTransition(PARTNER_HAS_HISTORY);
    }
    const partner = await tx.fulfilmentPartner.findUniqueOrThrow({ where: { id: partnerId }, include: { users: { select: { id: true, email: true } } } });
    const userIds = partner.users.map((user) => user.id);
    const policies = await tx.partnerInsurancePolicy.findMany({ where: { partnerId }, select: { fileId: true } });
    const files = await tx.storedFile.findMany({ where: { OR: [{ id: { in: policies.map((policy) => policy.fileId) } }, { ownerUserId: { in: userIds } }] }, select: { id: true, objectKey: true } });
    const owned = { partnerId };
    await tx.identityCheck.deleteMany({ where: { subjectId: { in: [partnerId, ...userIds] } } });
    await tx.partnerCheck.deleteMany({ where: owned });
    await tx.partnerAgreementAcceptance.deleteMany({ where: owned });
    await tx.partnerInsurancePolicy.deleteMany({ where: owned });
    await tx.partnerPayoutAccount.deleteMany({ where: owned });
    await tx.staffInvitation.deleteMany({ where: owned });
    await tx.warehouse.updateMany({ where: owned, data: { partnerId: null } });
    await tx.storedFile.deleteMany({ where: { id: { in: files.map((file) => file.id) } } });
    await tx.user.deleteMany({ where: { partnerId } });
    await tx.fulfilmentPartner.delete({ where: { id: partnerId } });
    await this.audit.record(
      {
        actor: { userId: principal.userId, role: principal.role },
        action: "partner.deleted",
        resourceType: "fulfilment_partner",
        resourceId: partnerId,
        countryCode: partner.countryCode,
        before: { reference: partner.reference, legalName: partner.legalName, contactEmail: partner.contactEmail, members: partner.users.map((user) => user.email) },
        after: { reason },
        meta,
      },
      tx,
    );
    return files.map((file) => file.objectKey);
  }

  private async removing(stillLinked: string, work: (tx: Prisma.TransactionClient) => Promise<string[]>): Promise<string[]> {
    try {
      return await this.prisma.$transaction(async (tx) => {
        await tx.$queryRaw`SELECT set_config('app.removing_account', 'on', true)`;
        return work(tx);
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2003") {
        throw Errors.invalidTransition(stillLinked);
      }
      throw error;
    }
  }

  private async removeObjects(objectKeys: readonly string[]): Promise<void> {
    for (const key of objectKeys) {
      for (const variant of new Set([key, key.replace(/^incoming\//, "verified/")])) {
        await this.storage.remove(variant).catch((error: unknown) => this.logger.warn({ key: variant, error }, "Could not remove a deleted account's file"));
      }
    }
  }
}
