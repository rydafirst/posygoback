import { Injectable } from "@nestjs/common";

import type { AuthPrincipal, RequestMeta } from "../../../common/auth/auth-principal";
import { Errors } from "../../../common/http/app-exception";
import { PrismaService } from "../../../database/prisma.service";
import type { Prisma, Product, ProductBarcode } from "../../../generated/prisma/client";
import { AuditService } from "../../../infrastructure/audit/audit.service";
import type { ProductInput, ProductStatus, ProductView } from "../../../shared";
import { FilesService } from "../../files/files.service";
import { vendorIdOf } from "../../onboarding/scope";
import { VendorStandingService } from "../../onboarding/vendor-standing.service";
import { uniqueViolationModel } from "../scope";

type ProductWithBarcodes = Product & { barcodes: ProductBarcode[] };

@Injectable()
export class CatalogueService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly standing: VendorStandingService,
    private readonly files: FilesService,
    private readonly audit: AuditService,
  ) {}

  async list(principal: AuthPrincipal, status: ProductStatus = "ACTIVE"): Promise<ProductView[]> {
    const rows = await this.prisma.product.findMany({
      where: { vendorId: vendorIdOf(principal), status },
      include: { barcodes: { orderBy: { createdAt: "asc" } } },
      orderBy: { code: "asc" },
      take: 1000,
    });
    return this.toViews(rows);
  }

  async get(principal: AuthPrincipal, productId: string): Promise<ProductView> {
    const [view] = await this.toViews([await this.owned(vendorIdOf(principal), productId)]);
    return view!;
  }

  async create(principal: AuthPrincipal, input: ProductInput, meta: RequestMeta): Promise<ProductView> {
    const vendor = await this.standing.assertCanTrade(principal);
    await this.assertImage(vendor.vendorId, input.imageFileId);
    const country = await this.prisma.country.findUniqueOrThrow({ where: { code: vendor.countryCode }, select: { currency: true } });
    const { barcodes, ...fields } = input;
    const productId = await this.write(async (tx) => {
      const created = await tx.product.create({
        data: { ...this.columns(fields), vendorId: vendor.vendorId, currency: country.currency, barcodes: { create: this.barcodeRows(vendor.vendorId, barcodes) } },
        select: { id: true },
      });
      await this.audit.record(
        {
          actor: { userId: principal.userId, role: principal.role },
          action: "product.created",
          resourceType: "product",
          resourceId: created.id,
          vendorId: vendor.vendorId,
          countryCode: vendor.countryCode,
          after: { code: fields.code },
          meta,
        },
        tx,
      );
      return created.id;
    });
    return this.get(principal, productId);
  }

  async update(principal: AuthPrincipal, productId: string, input: ProductInput, meta: RequestMeta): Promise<ProductView> {
    const vendor = await this.standing.assertCanTrade(principal);
    const existing = await this.owned(vendor.vendorId, productId);
    await this.assertImage(vendor.vendorId, input.imageFileId);
    const { barcodes, ...fields } = input;
    if (fields.code !== existing.code && (await this.prisma.inboundLine.count({ where: { productId: existing.id } })) > 0) {
      throw Errors.validation({ code: ["This product has been shipped, so its code can't change"] });
    }
    await this.write(async (tx) => {
      await tx.productBarcode.deleteMany({ where: { productId: existing.id } });
      await tx.product.update({ where: { id: existing.id }, data: { ...this.columns(fields), barcodes: { create: this.barcodeRows(vendor.vendorId, barcodes) } } });
      await this.audit.record(
        {
          actor: { userId: principal.userId, role: principal.role },
          action: "product.updated",
          resourceType: "product",
          resourceId: existing.id,
          vendorId: vendor.vendorId,
          countryCode: vendor.countryCode,
          before: { code: existing.code },
          after: { code: fields.code },
          meta,
        },
        tx,
      );
    });
    return this.get(principal, productId);
  }

  async setStatus(principal: AuthPrincipal, productId: string, status: ProductStatus, meta: RequestMeta): Promise<ProductView> {
    const vendorId = vendorIdOf(principal);
    const existing = await this.owned(vendorId, productId);
    await this.prisma.$transaction(async (tx) => {
      await tx.product.update({ where: { id: existing.id }, data: { status } });
      await this.audit.record(
        {
          actor: { userId: principal.userId, role: principal.role },
          action: status === "ARCHIVED" ? "product.archived" : "product.restored",
          resourceType: "product",
          resourceId: existing.id,
          vendorId,
          meta,
        },
        tx,
      );
    });
    return this.get(principal, productId);
  }

  async imageUrl(principal: AuthPrincipal, productId: string, meta: RequestMeta) {
    const product = await this.owned(vendorIdOf(principal), productId);
    if (!product.imageFileId) {
      throw Errors.notFound();
    }
    return this.files.linkedDownloadUrl(product.imageFileId, "PRODUCT_IMAGE", principal, meta);
  }

  private async owned(vendorId: string, productId: string): Promise<ProductWithBarcodes> {
    const row = await this.prisma.product.findFirst({ where: { id: productId, vendorId }, include: { barcodes: { orderBy: { createdAt: "asc" } } } });
    if (!row) {
      throw Errors.notFound();
    }
    return row;
  }

  private columns(fields: Omit<ProductInput, "barcodes">) {
    return {
      code: fields.code,
      name: fields.name,
      variantLabel: fields.variantLabel ?? null,
      hsCode: fields.hsCode ?? null,
      countryOfOrigin: fields.countryOfOrigin,
      declaredValueMinor: fields.declaredValueMinor,
      weightGrams: fields.weightGrams,
      lengthMm: fields.lengthMm ?? null,
      widthMm: fields.widthMm ?? null,
      heightMm: fields.heightMm ?? null,
      storageTier: fields.storageTier,
      imageFileId: fields.imageFileId ?? null,
    };
  }

  private barcodeRows(vendorId: string, barcodes: ProductInput["barcodes"]) {
    return barcodes.map((barcode) => ({ vendorId, value: barcode.value, symbology: barcode.symbology }));
  }

  private async write<T>(work: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> {
    try {
      return await this.prisma.$transaction(work);
    } catch (error) {
      const model = uniqueViolationModel(error);
      if (model === null) {
        throw error;
      }
      throw Errors.validation(model === "ProductBarcode" ? { barcodes: ["One of these barcodes is already on another product"] } : { code: ["You already have a product with this code"] });
    }
  }

  private async assertImage(vendorId: string, fileId: string | undefined): Promise<void> {
    if (!fileId) {
      return;
    }
    const statuses = await this.files.vendorFiles(vendorId, [fileId], "PRODUCT_IMAGE");
    if (statuses.get(fileId) !== "VERIFIED") {
      throw Errors.validation({ imageFileId: ["Upload the image again"] });
    }
  }

  private async toViews(rows: ProductWithBarcodes[]): Promise<ProductView[]> {
    if (rows.length === 0) {
      return [];
    }
    const stock = await this.prisma.stockLot.groupBy({
      by: ["productId", "condition"],
      where: { productId: { in: rows.map((row) => row.id) } },
      _sum: { quantityAvailable: true, quantityReserved: true },
    });
    const totals = (productId: string, condition: "SELLABLE" | "DAMAGED") => stock.find((entry) => entry.productId === productId && entry.condition === condition)?._sum;
    return rows.map((row) => ({
      id: row.id,
      code: row.code,
      name: row.name,
      variantLabel: row.variantLabel,
      hsCode: row.hsCode,
      countryOfOrigin: row.countryOfOrigin,
      declaredValue: { amountMinor: row.declaredValueMinor, currency: row.currency },
      weightGrams: row.weightGrams,
      lengthMm: row.lengthMm,
      widthMm: row.widthMm,
      heightMm: row.heightMm,
      storageTier: row.storageTier,
      imageFileId: row.imageFileId,
      barcodes: row.barcodes.map((barcode) => ({ value: barcode.value, symbology: barcode.symbology })),
      status: row.status,
      stock: {
        available: totals(row.id, "SELLABLE")?.quantityAvailable ?? 0,
        reserved: (totals(row.id, "SELLABLE")?.quantityReserved ?? 0) + (totals(row.id, "DAMAGED")?.quantityReserved ?? 0),
        damaged: totals(row.id, "DAMAGED")?.quantityAvailable ?? 0,
      },
      updatedAt: row.updatedAt.toISOString(),
    }));
  }
}
