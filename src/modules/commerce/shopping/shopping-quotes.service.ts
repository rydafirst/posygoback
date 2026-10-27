import { Inject, Injectable } from "@nestjs/common";

import type { AuthPrincipal, RequestMeta } from "../../../common/auth/auth-principal";
import { Errors } from "../../../common/http/app-exception";
import { APP_CONFIG } from "../../../config/config.module";
import type { AppConfig } from "../../../config/config.schema";
import { lockRow, PrismaService } from "../../../database/prisma.service";
import type { Prisma } from "../../../generated/prisma/client";
import { AuditService } from "../../../infrastructure/audit/audit.service";
import { EMAIL_SENDER, type EmailSender } from "../../../infrastructure/email/email.port";
import { Money, SHOPPING_RULES, shoppingCommission, shoppingRates, type ShoppingQuoteInput, type ShoppingRequestView, type ShoppingStatus } from "../../../shared";
import { FilesService } from "../../files/files.service";
import { FeeSchedulesService } from "../../finance/fees/fee-schedules.service";
import { reviewerCountryScope } from "../../onboarding/scope";
import type { CustomsItem } from "../../orders/carriers/carrier.port";
import { DeliveryQuotesService } from "../checkout/delivery-quotes.service";
import { ShoppingEmails } from "./shopping-emails";
import { SHOPPING_INCLUDE, ShoppingRepository, type ShoppingRow, type StoredParcel } from "./shopping.repository";
import { ShoppingRequestsService } from "./shopping-requests.service";

const QUOTABLE: ShoppingStatus[] = ["REQUESTED", "QUOTED", "EXPIRED"];
const DAY_MS = 24 * 60 * 60 * 1000;

@Injectable()
export class ShoppingQuotesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly repository: ShoppingRepository,
    private readonly requests: ShoppingRequestsService,
    private readonly delivery: DeliveryQuotesService,
    private readonly fees: FeeSchedulesService,
    private readonly files: FilesService,
    private readonly audit: AuditService,
    @Inject(EMAIL_SENDER) private readonly email: EmailSender,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  async list(principal: AuthPrincipal, status?: ShoppingStatus): Promise<ShoppingRequestView[]> {
    const country = reviewerCountryScope(principal);
    const rows = await this.prisma.shoppingRequest.findMany({
      where: { confirmedAt: { not: null }, ...(country ? { countryCode: country } : {}), ...(status ? { status } : {}) },
      include: SHOPPING_INCLUDE,
      orderBy: { createdAt: "asc" },
      take: 200,
    });
    return rows.map((row) => this.repository.view(row, "STAFF"));
  }

  async detail(principal: AuthPrincipal, requestId: string): Promise<ShoppingRequestView> {
    return this.repository.view(await this.scoped(principal, requestId), "STAFF");
  }

  async photo(principal: AuthPrincipal, requestId: string, fileId: string, meta: RequestMeta) {
    const row = await this.scoped(principal, requestId);
    if (!(row.arrivalPhotoFileIds as string[]).includes(fileId)) {
      throw Errors.notFound();
    }
    return this.files.linkedDownloadUrl(fileId, "EVIDENCE_PHOTO", principal, meta);
  }

  async scoped(principal: AuthPrincipal, requestId: string): Promise<ShoppingRow> {
    const country = reviewerCountryScope(principal);
    const row = await this.prisma.shoppingRequest.findFirst({ where: { id: requestId, confirmedAt: { not: null }, ...(country ? { countryCode: country } : {}) }, include: SHOPPING_INCLUDE });
    if (!row) {
      throw Errors.notFound();
    }
    return row;
  }

  async quote(principal: AuthPrincipal, requestId: string, input: ShoppingQuoteInput, meta: RequestMeta): Promise<ShoppingRequestView> {
    const row = await this.scoped(principal, requestId);
    if (!QUOTABLE.includes(row.status)) {
      throw Errors.invalidTransition("This request can't be priced any more.");
    }
    this.assertEveryLine(row, input);
    const warehouse = await this.prisma.warehouse.findFirst({ where: { id: input.warehouseId, countryCode: row.countryCode, active: true } });
    const box = await this.prisma.packagingPreset.findFirst({ where: { id: input.packagingPresetId, countryCode: row.countryCode, active: true } });
    if (!warehouse || !box) {
      throw Errors.validation(warehouse ? { packagingPresetId: ["Choose a box from this country"] } : { warehouseId: ["Choose an active warehouse in this country"] });
    }
    const shipTo = this.repository.shipTo(row);
    const lane = await this.requests.lane(this.prisma, row.countryCode, shipTo);
    const available = input.lines.filter((line) => line.available);
    if (lane.customsRequired && available.some((line) => !line.hsCode)) {
      throw Errors.validation({ lines: ["Add a customs code for every item going abroad"] });
    }
    const quantityOf = new Map(row.lines.map((line) => [line.id, line.quantity]));
    const goodsMinor = available.reduce((total, line) => total + line.unitPriceMinor! * quantityOf.get(line.lineId)!, 0);
    const weightGrams = available.reduce((total, line) => total + line.unitWeightGrams! * quantityOf.get(line.lineId)!, SHOPPING_RULES.packingAllowanceGrams as number);
    const parcel = { lengthMm: box.lengthMm, widthMm: box.widthMm, heightMm: box.heightMm, weightGrams };
    const customs: CustomsItem[] | null = lane.customsRequired
      ? available.map((line) => ({
          description: row.lines.find((candidate) => candidate.id === line.lineId)!.description.slice(0, 100),
          quantity: quantityOf.get(line.lineId)!,
          unitValueMinor: line.unitPriceMinor!,
          netWeightGrams: line.unitWeightGrams!,
          originCountry: row.countryCode,
          hsCode: line.hsCode!,
        }))
      : null;
    const { schedule } = await this.fees.active(row.countryCode);
    const options = await this.delivery.optionsFor(warehouse, shipTo, parcel, customs, row.currency, schedule);
    const commissionMinor = shoppingCommission(shoppingRates(schedule), goodsMinor);
    const deliveryMinor = options[0]!.priceMinor;
    const stored: StoredParcel = { packagingPresetId: box.id, ...parcel, options, customs };
    const expiresAt = new Date(Date.now() + SHOPPING_RULES.quoteValidDays * DAY_MS);
    await this.prisma.$transaction(async (tx) => {
      await lockRow(tx, "shoppingRequests", row.id);
      const current = await tx.shoppingRequest.findUniqueOrThrow({ where: { id: row.id } });
      if (!QUOTABLE.includes(current.status)) {
        throw Errors.invalidTransition("This request can't be priced any more.");
      }
      for (const line of input.lines) {
        await tx.shoppingLine.update({
          where: { id: line.lineId },
          data: line.available
            ? { status: "QUOTED", unitPriceMinor: BigInt(line.unitPriceMinor!), unitWeightGrams: line.unitWeightGrams!, hsCode: line.hsCode ?? null, staffNote: line.staffNote ?? null }
            : { status: "UNAVAILABLE", unitPriceMinor: null, unitWeightGrams: null, hsCode: null, staffNote: line.staffNote ?? null },
        });
      }
      await tx.shoppingRequest.update({
        where: { id: row.id },
        data: {
          status: "QUOTED",
          warehouseId: warehouse.id,
          goodsMinor: BigInt(goodsMinor),
          commissionMinor: BigInt(commissionMinor),
          deliveryMinor: BigInt(deliveryMinor),
          totalMinor: BigInt(goodsMinor + commissionMinor + deliveryMinor),
          parcel: stored as unknown as Prisma.InputJsonValue,
          quoteExpiresAt: expiresAt,
          quotedBy: principal.userId,
          quotedAt: new Date(),
          provider: null,
          providerReference: null,
        },
      });
      await this.audit.record(
        {
          actor: { userId: principal.userId, role: principal.role },
          action: "shopping.quoted",
          resourceType: "shopping_request",
          resourceId: row.id,
          countryCode: row.countryCode,
          after: { goodsMinor, commissionMinor, deliveryMinor, unavailable: input.lines.length - available.length },
          meta,
        },
        tx,
      );
    });
    const total = Money.of(goodsMinor + commissionMinor + deliveryMinor, row.currency).format("en-GB");
    await this.email.send(ShoppingEmails.quoted(row.buyerEmail, row.reference, total, this.config.WEB_PUBLIC_URL)).catch(() => undefined);
    return this.detail(principal, row.id);
  }

  async expireDue(now = new Date()): Promise<number> {
    const expired = await this.prisma.shoppingRequest.updateMany({ where: { status: "QUOTED", quoteExpiresAt: { lt: now } }, data: { status: "EXPIRED" } });
    return expired.count;
  }

  private assertEveryLine(row: ShoppingRow, input: ShoppingQuoteInput): void {
    const known = new Set(row.lines.map((line) => line.id));
    if (input.lines.length !== known.size || input.lines.some((line) => !known.has(line.lineId))) {
      throw Errors.validation({ lines: ["Price or mark unavailable every item on the request"] });
    }
  }
}
