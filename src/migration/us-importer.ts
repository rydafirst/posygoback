import type { PrismaService } from "../database/prisma.service";
import type { Prisma, Warehouse } from "../generated/prisma/client";
import { type AuditService, SYSTEM_ACTOR } from "../infrastructure/audit/audit.service";
import type { WalletLedgerService } from "../modules/finance/wallets/wallet-ledger.service";
import type { InventoryLedgerService } from "../modules/stock/inventory/inventory-ledger.service";
import { lotCode, randomCode } from "../modules/stock/inbound/references";
import type { ImportPlan, PlannedProduct, PlannedVendor, Problem } from "./us-plan";

export const SOURCE = { vendors: "usaerrands.vendors", users: "usaerrands.users", products: "usaerrands.products" } as const;
const COUNTRY = "US";
const CURRENCY = "USD";

function firstOfNextMonth(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 1));
}

export class UsImporter {
  constructor(
    private readonly prisma: PrismaService,
    private readonly wallets: WalletLedgerService,
    private readonly inventory: InventoryLedgerService,
    private readonly audit: AuditService,
  ) {}

  async warehouse(code: string): Promise<Warehouse> {
    const warehouse = await this.prisma.warehouse.findFirst({ where: { code, countryCode: COUNTRY, active: true, partnerId: null } });
    if (!warehouse) {
      throw new Error(`No active platform warehouse ${code} in the US`);
    }
    return warehouse;
  }

  async targetProblems(plan: ImportPlan): Promise<Problem[]> {
    const problems: Problem[] = [];
    const country = await this.prisma.country.findUnique({ where: { code: COUNTRY } });
    if (!country || country.currency !== CURRENCY) {
      problems.push({ severity: "BLOCKER", subject: "New system", detail: "The US market isn't set up with USD" });
    }
    const moved = new Set((await this.prisma.migrationLink.findMany({ where: { sourceTable: SOURCE.users } })).map((link) => link.sourceId));
    const emails = plan.vendors.flatMap((vendor) => vendor.users.filter((user) => !moved.has(user.sourceId)).map((user) => user.email));
    const taken = await this.prisma.user.findMany({ where: { email: { in: emails } }, select: { email: true } });
    for (const user of taken) {
      problems.push({ severity: "BLOCKER", subject: user.email, detail: "Already has an account on the new system" });
    }
    return problems;
  }

  async importAll(plan: ImportPlan, warehouse: Warehouse): Promise<{ imported: number; skipped: number }> {
    let imported = 0;
    for (const vendor of plan.vendors) {
      if (await this.link(this.prisma, SOURCE.vendors, vendor.sourceId)) {
        continue;
      }
      await this.prisma.$transaction((tx) => this.importVendor(tx, vendor, warehouse), { timeout: 120_000 });
      imported += 1;
    }
    return { imported, skipped: plan.vendors.length - imported };
  }

  async link(client: Prisma.TransactionClient | PrismaService, sourceTable: string, sourceId: string): Promise<string | null> {
    return (await client.migrationLink.findUnique({ where: { sourceTable_sourceId: { sourceTable, sourceId } } }))?.targetId ?? null;
  }

  private async importVendor(tx: Prisma.TransactionClient, planned: PlannedVendor, warehouse: Warehouse): Promise<void> {
    const vendor = await tx.vendor.create({ data: { businessName: planned.businessName, countryCode: COUNTRY, status: planned.status } });
    await tx.migrationLink.create({ data: { sourceTable: SOURCE.vendors, sourceId: planned.sourceId, targetId: vendor.id } });
    let ownerId = "";
    for (const user of planned.users) {
      const created = await tx.user.create({
        data: {
          email: user.email,
          passwordHash: user.passwordHash,
          role: user.role,
          vendorId: vendor.id,
          status: user.active ? "ACTIVE" : "PENDING_EMAIL_VERIFICATION",
          emailVerifiedAt: user.active ? new Date() : null,
        },
      });
      await tx.migrationLink.create({ data: { sourceTable: SOURCE.users, sourceId: user.sourceId, targetId: created.id } });
      ownerId ||= user.role === "VENDOR_OWNER" ? created.id : "";
    }
    const products = [];
    for (const product of planned.products) {
      products.push({ planned: product, id: await this.importProduct(tx, vendor.id, product) });
    }
    const stocked = products.filter((entry) => entry.planned.sellable + entry.planned.damaged > 0);
    if (stocked.length > 0) {
      await this.importStock(tx, vendor.id, ownerId, warehouse, stocked);
    }
    if (planned.walletCents > 0) {
      const wallet = await this.wallets.walletFor(tx, vendor.id, CURRENCY);
      await this.wallets.post(tx, wallet.id, {
        type: "CARRIED_OVER",
        amountMinor: planned.walletCents,
        description: "Balance carried over from your previous account",
        idempotencyKey: `carried-over:${planned.sourceId}`,
      });
    }
    await this.audit.record(
      {
        actor: SYSTEM_ACTOR,
        action: "migration.vendor_moved",
        resourceType: "vendor",
        resourceId: vendor.id,
        vendorId: vendor.id,
        countryCode: COUNTRY,
        after: { users: planned.users.length, products: planned.products.length, walletMinor: planned.walletCents },
      },
      tx,
    );
  }

  private async importProduct(tx: Prisma.TransactionClient, vendorId: string, product: PlannedProduct): Promise<string> {
    const { barcodes, ...input } = product.input;
    const created = await tx.product.create({
      data: { ...input, vendorId, currency: CURRENCY, barcodes: { create: barcodes.map((barcode) => ({ vendorId, value: barcode.value, symbology: barcode.symbology })) } },
    });
    await tx.migrationLink.create({ data: { sourceTable: SOURCE.products, sourceId: product.sourceId, targetId: created.id } });
    return created.id;
  }

  private async importStock(tx: Prisma.TransactionClient, vendorId: string, ownerId: string, warehouse: Warehouse, stocked: Array<{ planned: PlannedProduct; id: string }>): Promise<void> {
    const now = new Date();
    const inbound = await tx.inboundShipment.create({
      data: {
        reference: `IN-US-${randomCode(6)}`,
        vendorId,
        warehouseId: warehouse.id,
        countryCode: COUNTRY,
        status: "RECEIVED",
        shippingMode: "LOOSE",
        expectedArrivalDate: now,
        declaredBoxCounts: {},
        receivedBoxCounts: {},
        createdBy: ownerId,
        receivedAt: now,
        notes: "Stock carried over from the previous system",
      },
    });
    const locations = new Map((await tx.inventoryLocation.findMany({ where: { warehouseId: warehouse.id, active: true } })).map((location) => [location.code, location.id]));
    for (const { planned, id } of stocked) {
      const batches = [
        { condition: "SELLABLE" as const, quantity: planned.sellable },
        { condition: "DAMAGED" as const, quantity: planned.damaged },
      ].filter((batch) => batch.quantity > 0);
      for (const [index, batch] of batches.entries()) {
        const lot = await tx.stockLot.create({
          data: {
            code: lotCode(COUNTRY, vendorId, planned.input.code, index + 1),
            vendorId,
            productId: id,
            warehouseId: warehouse.id,
            inboundId: inbound.id,
            condition: batch.condition,
            storageTier: planned.input.storageTier,
            quantityAvailable: batch.quantity,
            locationId: planned.locationCodes.length === 1 ? (locations.get(planned.locationCodes[0]!) ?? null) : null,
            receivedAt: now,
          },
        });
        await this.inventory.record(
          tx,
          lot,
          null,
          { type: "RECEIVE", deltaAvailable: batch.quantity, reason: "Carried over from the previous system", reference: { type: "inbound_shipment", id: inbound.id } },
          { type: "RECEIVED", quantity: batch.quantity },
        );
      }
      await tx.storageBox.create({ data: { vendorId, warehouseId: warehouse.id, inboundId: inbound.id, tier: planned.input.storageTier, receivedAt: now, nextBillingDate: firstOfNextMonth(now) } });
    }
  }
}
