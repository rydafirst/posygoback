import { Injectable } from "@nestjs/common";

import type { AuthPrincipal, RequestMeta } from "../../../common/auth/auth-principal";
import type { SellerCountry } from "../../../common/auth/selected-country";
import { Errors } from "../../../common/http/app-exception";
import { lockRow, PrismaService } from "../../../database/prisma.service";
import type { Prisma, StorageBox } from "../../../generated/prisma/client";
import { AuditService } from "../../../infrastructure/audit/audit.service";
import {
  type BoxCounts,
  type BoxGroupView,
  type HubBoxesView,
  type HubRepackListView,
  Money,
  monthlyCost,
  REPACK_HINT_SHARE,
  type RepackBoxesInput,
  STORAGE_TIERS,
  type StorageTier,
  type VendorBoxesView,
} from "../../../shared";
import { FilesService } from "../../files/files.service";
import { FeeSchedulesService } from "../../finance/fees/fee-schedules.service";
import { NotificationsService } from "../../notifications/notifications.service";
import { WarehouseAccessService } from "../warehouses/warehouse-access.service";
import { closeEmptyBoxes, unitsStored } from "./close-empty-boxes";

type Monthly = Record<StorageTier, number | null>;

function countsOf(boxes: readonly Pick<StorageBox, "tier">[]): BoxCounts {
  const counts: BoxCounts = {};
  for (const box of boxes) {
    counts[box.tier] = (counts[box.tier] ?? 0) + 1;
  }
  return counts;
}

function groups(boxes: readonly Pick<StorageBox, "tier" | "supplied">[], monthly: Monthly): BoxGroupView[] {
  return STORAGE_TIERS.flatMap((tier) => {
    const ofTier = boxes.filter((box) => box.tier === tier);
    return ofTier.length === 0 ? [] : [{ tier, count: ofTier.length, supplied: ofTier.filter((box) => box.supplied).length, monthlyMinor: monthly[tier] }];
  });
}

function earliest(dates: readonly (Date | null)[]): Date | null {
  return dates.reduce<Date | null>((first, date) => (date && (!first || date < first) ? date : first), null);
}

function describe(counts: BoxCounts): string {
  return STORAGE_TIERS.filter((tier) => (counts[tier] ?? 0) > 0)
    .map((tier) => `${counts[tier]} ${tier.replace("_", " ").toLowerCase()}`)
    .join(", ");
}

@Injectable()
export class StorageBoxesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly warehouses: WarehouseAccessService,
    private readonly fees: FeeSchedulesService,
    private readonly files: FilesService,
    private readonly notifications: NotificationsService,
    private readonly audit: AuditService,
  ) {}

  async vendorBoxes(country: SellerCountry): Promise<VendorBoxesView> {
    const { schedule, currency } = await this.fees.active(country.countryCode);
    const open = await this.openBoxes({ vendorId: country.vendorId, warehouse: { countryCode: country.countryCode } });
    const hubs: HubBoxesView[] = [];
    for (const warehouseId of new Set(open.map((box) => box.warehouseId))) {
      const boxes = open.filter((box) => box.warehouseId === warehouseId);
      const units = await unitsStored(this.prisma, country.vendorId, warehouseId);
      if (units === 0) {
        await closeEmptyBoxes(this.prisma, country.vendorId, warehouseId);
        continue;
      }
      hubs.push({
        warehouseId,
        warehouseName: boxes[0]!.warehouse.name,
        boxes: groups(boxes, schedule.monthlyStorage),
        monthlyMinor: monthlyCost(countsOf(boxes), schedule.monthlyStorage),
        nextChargeOn: earliest(boxes.map((box) => box.nextBillingDate))?.toISOString().slice(0, 10) ?? null,
        unitsStored: units,
      });
    }
    return { currency, hubs, monthlyMinor: hubs.reduce((total, hub) => total + hub.monthlyMinor, 0) };
  }

  async hubBoxes(principal: AuthPrincipal, warehouseId: string): Promise<HubRepackListView> {
    const warehouse = await this.warehouses.inScope(principal, warehouseId);
    const { schedule, currency } = await this.fees.active(warehouse.countryCode);
    const open = await this.openBoxes({ warehouseId });
    const vendors: HubRepackListView["vendors"] = [];
    for (const vendorId of new Set(open.map((box) => box.vendorId))) {
      const boxes = open.filter((box) => box.vendorId === vendorId);
      const units = await unitsStored(this.prisma, vendorId, warehouseId);
      if (units === 0) {
        await closeEmptyBoxes(this.prisma, vendorId, warehouseId);
        continue;
      }
      const arrived = await this.prisma.inboundLine.aggregate({
        where: { inboundId: { in: [...new Set(boxes.map((box) => box.inboundId))] } },
        _sum: { acceptedQuantity: true, damagedQuantity: true },
      });
      const unitsAtArrival = (arrived._sum.acceptedQuantity ?? 0) + (arrived._sum.damagedQuantity ?? 0);
      vendors.push({
        vendorId,
        businessName: boxes[0]!.vendor.businessName,
        boxes: groups(boxes, schedule.monthlyStorage),
        monthlyMinor: monthlyCost(countsOf(boxes), schedule.monthlyStorage),
        unitsStored: units,
        unitsAtArrival,
        worthRepacking: boxes.length > 1 && units <= unitsAtArrival * REPACK_HINT_SHARE,
      });
    }
    vendors.sort((a, b) => Number(b.worthRepacking) - Number(a.worthRepacking) || a.businessName.localeCompare(b.businessName));
    return { currency, monthlyRates: schedule.monthlyStorage, vendors };
  }

  async repack(principal: AuthPrincipal, warehouseId: string, input: RepackBoxesInput, meta: RequestMeta): Promise<HubRepackListView> {
    const warehouse = await this.warehouses.inScope(principal, warehouseId);
    const statuses = await this.files.uploadedBy(principal.userId, input.photoFileIds, "EVIDENCE_PHOTO");
    if (input.photoFileIds.some((id) => statuses.get(id) !== "VERIFIED")) {
      throw Errors.validation({ photoFileIds: ["Some photos are missing or still uploading. Add them again."] });
    }
    const { schedule, currency } = await this.fees.active(warehouse.countryCode);
    const outcome = await this.prisma.$transaction(async (tx) => {
      await lockRow(tx, "vendors", input.vendorId);
      const boxes = await tx.storageBox.findMany({ where: { vendorId: input.vendorId, warehouseId, removedAt: null } });
      if (boxes.length === 0 || (await unitsStored(tx, input.vendorId, warehouseId)) === 0) {
        throw Errors.invalidTransition("This seller has nothing stored here to repack.");
      }
      const before = countsOf(boxes);
      const beforeMinor = monthlyCost(before, schedule.monthlyStorage);
      const afterMinor = monthlyCost(input.boxCounts, schedule.monthlyStorage);
      if (afterMinor >= beforeMinor) {
        throw Errors.validation({ boxCounts: ["Repacking has to bring the seller's monthly storage down. Keep the boxes as they are."] });
      }
      await this.replaceBoxes(tx, boxes, input.boxCounts);
      await tx.boxRepack.create({
        data: { vendorId: input.vendorId, warehouseId, beforeCounts: before, afterCounts: input.boxCounts, photoFileIds: input.photoFileIds, note: input.note ?? null, createdBy: principal.userId },
      });
      await this.audit.record(
        {
          actor: { userId: principal.userId, role: principal.role },
          action: "storage.repacked",
          resourceType: "warehouse",
          resourceId: warehouseId,
          vendorId: input.vendorId,
          countryCode: warehouse.countryCode,
          before: { boxes: before, monthlyMinor: beforeMinor },
          after: { boxes: input.boxCounts, monthlyMinor: afterMinor },
          meta,
        },
        tx,
      );
      return { before, beforeMinor, afterMinor };
    });
    const money = (minor: number) => Money.of(minor, currency).format("en-GB");
    await this.notifications.forVendor(input.vendorId, {
      title: "We repacked your stock to save you money",
      body: `At ${warehouse.name}, your stock now fits in ${describe(input.boxCounts)} instead of ${describe(outcome.before)}. Monthly storage drops from ${money(outcome.beforeMinor)} to ${money(outcome.afterMinor)}.`,
      href: "/inventory",
    });
    return this.hubBoxes(principal, warehouseId);
  }

  private async replaceBoxes(tx: Prisma.TransactionClient, boxes: readonly StorageBox[], counts: BoxCounts): Promise<void> {
    const now = new Date();
    await tx.storageBox.updateMany({ where: { id: { in: boxes.map((box) => box.id) } }, data: { removedAt: now, closedReason: "REPACKED" } });
    const latest = [...boxes].sort((a, b) => b.receivedAt.getTime() - a.receivedAt.getTime())[0]!;
    const nextBillingDate = earliest(boxes.map((box) => box.nextBillingDate));
    const supplied = boxes.every((box) => box.supplied);
    await tx.storageBox.createMany({
      data: STORAGE_TIERS.flatMap((tier) =>
        Array.from({ length: counts[tier] ?? 0 }, () => ({ vendorId: latest.vendorId, warehouseId: latest.warehouseId, inboundId: latest.inboundId, tier, receivedAt: now, nextBillingDate, supplied })),
      ),
    });
  }

  private openBoxes(where: Prisma.StorageBoxWhereInput) {
    return this.prisma.storageBox.findMany({
      where: { ...where, removedAt: null },
      include: { warehouse: { select: { name: true } }, vendor: { select: { businessName: true } } },
      orderBy: { receivedAt: "asc" },
    });
  }
}
