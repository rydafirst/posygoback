import { Inject, Injectable } from "@nestjs/common";

import type { AuthPrincipal, RequestMeta } from "../../../common/auth/auth-principal";
import { AppException, Errors } from "../../../common/http/app-exception";
import { APP_CONFIG } from "../../../config/config.module";
import type { AppConfig } from "../../../config/config.schema";
import { lockRow, PrismaService } from "../../../database/prisma.service";
import type { Prisma, ShoppingLine } from "../../../generated/prisma/client";
import { AuditService } from "../../../infrastructure/audit/audit.service";
import { EMAIL_SENDER, type EmailSender } from "../../../infrastructure/email/email.port";
import { SHOPPING_RULES, type ShoppingArrivalInput, type ShoppingRequestView, type ShoppingStatus } from "../../../shared";
import { FilesService } from "../../files/files.service";
import { CarrierAccountsService } from "../../orders/carriers/carrier-accounts.service";
import { warehouseScope } from "../../stock/scope";
import { DeliveryQuotesService } from "../checkout/delivery-quotes.service";
import { ShoppingEmails } from "./shopping-emails";
import { actorOf, commissionShare, ShoppingPurchasesService } from "./shopping-purchases.service";
import { SHOPPING_INCLUDE, ShoppingRepository, type ShoppingRow, type StoredParcel } from "./shopping.repository";
import { ShoppingRefundsService } from "./shopping-refunds.service";

const WAREHOUSE_STATUSES: ShoppingStatus[] = ["BUYING", "ARRIVED", "SHIPPED"];
const LABEL_CLAIM_MS = 10 * 60 * 1000;

function receivedParcel(parcel: StoredParcel, lines: ReadonlyArray<ShoppingLine & { counted: number }>, originCountry: string): StoredParcel {
  const arrived = lines.filter((line) => line.counted > 0);
  return {
    ...parcel,
    weightGrams: arrived.reduce((total, line) => total + (line.unitWeightGrams ?? 0) * line.counted, SHOPPING_RULES.packingAllowanceGrams as number),
    customs: parcel.customs
      ? arrived.map((line) => ({
          description: line.description.slice(0, 100),
          quantity: line.counted,
          unitValueMinor: Number(line.unitPriceMinor),
          netWeightGrams: line.unitWeightGrams ?? 1,
          originCountry,
          hsCode: line.hsCode ?? "",
        }))
      : null,
  };
}

@Injectable()
export class ShoppingWarehouseService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly repository: ShoppingRepository,
    private readonly refunds: ShoppingRefundsService,
    private readonly purchases: ShoppingPurchasesService,
    private readonly delivery: DeliveryQuotesService,
    private readonly carriers: CarrierAccountsService,
    private readonly files: FilesService,
    private readonly audit: AuditService,
    @Inject(EMAIL_SENDER) private readonly email: EmailSender,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  async list(principal: AuthPrincipal): Promise<ShoppingRequestView[]> {
    const rows = await this.prisma.shoppingRequest.findMany({
      where: { warehouse: warehouseScope(principal), status: { in: WAREHOUSE_STATUSES } },
      include: SHOPPING_INCLUDE,
      orderBy: { paidAt: "asc" },
      take: 200,
    });
    return rows.map((row) => this.repository.view(row, "WAREHOUSE"));
  }

  async arrive(principal: AuthPrincipal, requestId: string, input: ShoppingArrivalInput, meta: RequestMeta): Promise<ShoppingRequestView> {
    const row = await this.scoped(principal, requestId);
    const photos = await this.files.uploadedBy(principal.userId, input.photoFileIds, "EVIDENCE_PHOTO");
    if (input.photoFileIds.some((id) => photos.get(id) !== "VERIFIED")) {
      throw Errors.validation({ photoFileIds: ["Wait for every photo to finish uploading"] });
    }
    const outcome = await this.prisma.$transaction(async (tx) => {
      await lockRow(tx, "shoppingRequests", row.id);
      const current = await tx.shoppingRequest.findUniqueOrThrow({ where: { id: row.id }, include: { lines: true } });
      if (current.status !== "BUYING" || current.lines.some((line) => line.status === "QUOTED")) {
        throw Errors.invalidTransition("Mark every item as bought or out of stock before booking it in.");
      }
      if (current.disputeOpen) {
        throw Errors.invalidTransition("The buyer has disputed this payment. Keep the items aside until it's settled.");
      }
      const counted = this.counted(current.lines, input);
      const shortMinor = counted.reduce((total, line) => total + Number(line.unitPriceMinor) * (line.quantity - line.counted), 0);
      const nothing = counted.every((line) => line.counted === 0);
      for (const line of counted) {
        await tx.shoppingLine.update({ where: { id: line.id }, data: { status: "RECEIVED", receivedQuantity: line.counted } });
      }
      const parcel = receivedParcel(this.repository.parcel(current)!, counted, current.countryCode);
      await tx.shoppingRequest.update({
        where: { id: row.id },
        data: nothing
          ? { status: "CANCELLED", cancelReason: "None of the items reached our warehouse.", receivedBy: principal.userId, arrivalPhotoFileIds: input.photoFileIds }
          : { status: "ARRIVED", receivedBy: principal.userId, arrivalPhotoFileIds: input.photoFileIds, parcel: parcel as unknown as Prisma.InputJsonValue },
      });
      await this.audit.record(
        {
          actor: actorOf(principal),
          action: "shopping.arrived",
          resourceType: "shopping_request",
          resourceId: row.id,
          countryCode: row.countryCode,
          after: { photos: input.photoFileIds.length, shortMinor },
          meta,
        },
        tx,
      );
      if (nothing) {
        return { nothing, intent: await this.refunds.reserve(tx, row.id, Number(current.totalMinor), `shopping-cancel:${row.id}`, "Nothing arrived") };
      }
      return { nothing, intent: shortMinor > 0 ? await this.refunds.reserve(tx, row.id, shortMinor + commissionShare(current, shortMinor), `shopping-short:${row.id}`, "Items didn't arrive") : null };
    });
    if (outcome.nothing) {
      await this.purchases.sendThenTell(outcome.intent?.id ?? null, actorOf(principal), (amount) =>
        ShoppingEmails.cancelled(row.buyerEmail, row.reference, "None of the items reached our warehouse, so we've cancelled your request.", amount, this.config.WEB_PUBLIC_URL),
      );
    } else if (outcome.intent) {
      await this.purchases.sendThenTell(outcome.intent.id, actorOf(principal), (amount) =>
        amount ? ShoppingEmails.partlyRefunded(row.buyerEmail, row.reference, amount, this.config.WEB_PUBLIC_URL) : null,
      );
    }
    return this.repository.view(await this.scoped(principal, row.id, ["BUYING", "ARRIVED", "CANCELLED"]), "WAREHOUSE");
  }

  async ship(principal: AuthPrincipal, requestId: string, meta: RequestMeta): Promise<ShoppingRequestView> {
    const row = await this.scoped(principal, requestId);
    const parcel = this.repository.parcel(row);
    if (row.status !== "ARRIVED" || !parcel || !row.warehouseId) {
      throw Errors.invalidTransition("Book the items in before sending them.");
    }
    const now = new Date();
    const claimed = await this.prisma.shoppingRequest.updateMany({
      where: { id: row.id, status: "ARRIVED", disputeOpen: false, OR: [{ labelClaimedAt: null }, { labelClaimedAt: { lt: new Date(now.getTime() - LABEL_CLAIM_MS) } }] },
      data: { labelClaimedAt: now },
    });
    if (claimed.count === 0) {
      throw Errors.invalidTransition(row.disputeOpen ? "The buyer has disputed this payment. Keep the items aside until it's settled." : "Someone is already buying the label for this parcel.");
    }
    const warehouse = await this.prisma.warehouse.findUniqueOrThrow({ where: { id: row.warehouseId } });
    const label = await this.delivery
      .rates(warehouse, this.repository.shipTo(row), parcel, parcel.customs, row.currency, row.reference)
      .then((rates) => this.carriers.forCountry(warehouse.countryCode).adapter.buyLabel(this.delivery.choose(rates, parcel.speed ?? "STANDARD"), row.reference))
      .catch(async (error: unknown) => {
        await this.prisma.shoppingRequest.updateMany({ where: { id: row.id, labelClaimedAt: now }, data: { labelClaimedAt: null } });
        throw error instanceof AppException ? error : Errors.carrierFailed("The carrier didn't issue a label. Try again shortly.");
      });
    await this.prisma.$transaction(async (tx) => {
      await lockRow(tx, "shoppingRequests", row.id);
      await tx.shoppingRequest.update({
        where: { id: row.id },
        data: {
          status: "SHIPPED",
          carrier: label.carrier.slice(0, 60),
          trackingNumber: label.trackingNumber.slice(0, 64),
          trackingUrl: label.trackingUrl?.slice(0, 500) ?? null,
          labelUrl: label.labelUrl?.slice(0, 500) ?? null,
          shippedBy: principal.userId,
          shippedAt: new Date(),
        },
      });
      await this.audit.record(
        {
          actor: actorOf(principal),
          action: "shopping.shipped",
          resourceType: "shopping_request",
          resourceId: row.id,
          countryCode: row.countryCode,
          after: { carrier: label.carrier, trackingNumber: label.trackingNumber },
          meta,
        },
        tx,
      );
    });
    await this.email.send(ShoppingEmails.shipped(row.buyerEmail, row.reference, label.carrier, label.trackingNumber, label.trackingUrl ?? null, this.config.WEB_PUBLIC_URL)).catch(() => undefined);
    return this.repository.view(await this.scoped(principal, row.id), "WAREHOUSE");
  }

  async delivered(principal: AuthPrincipal, requestId: string, meta: RequestMeta): Promise<ShoppingRequestView> {
    const row = await this.scoped(principal, requestId);
    const moved = await this.prisma.shoppingRequest.updateMany({ where: { id: row.id, status: "SHIPPED" }, data: { status: "DELIVERED", deliveredAt: new Date() } });
    if (moved.count === 0) {
      throw Errors.invalidTransition("Only sent items can be marked as delivered.");
    }
    await this.audit.record({ actor: actorOf(principal), action: "shopping.delivered", resourceType: "shopping_request", resourceId: row.id, countryCode: row.countryCode, meta });
    await this.email.send(ShoppingEmails.delivered(row.buyerEmail, row.reference, this.config.WEB_PUBLIC_URL)).catch(() => undefined);
    return this.repository.view(await this.scoped(principal, row.id, ["DELIVERED"]), "WAREHOUSE");
  }

  private counted(lines: readonly ShoppingLine[], input: ShoppingArrivalInput): Array<ShoppingLine & { counted: number }> {
    const bought = lines.filter((line) => line.status === "BOUGHT");
    const counts = new Map(input.lines.map((line) => [line.lineId, line.receivedQuantity]));
    if (bought.length === 0 || input.lines.length !== bought.length || bought.some((line) => !counts.has(line.id))) {
      throw Errors.validation({ lines: ["Count every item that was bought, even if none arrived"] });
    }
    const over = bought.find((line) => counts.get(line.id)! > line.quantity);
    if (over) {
      throw Errors.validation({ [`lines.${over.id}`]: [`Only ${over.quantity} were bought`] });
    }
    return bought.map((line) => ({ ...line, counted: counts.get(line.id)! }));
  }

  private async scoped(principal: AuthPrincipal, requestId: string, statuses: ShoppingStatus[] = WAREHOUSE_STATUSES): Promise<ShoppingRow> {
    const row = await this.prisma.shoppingRequest.findFirst({ where: { id: requestId, warehouse: warehouseScope(principal), status: { in: statuses } }, include: SHOPPING_INCLUDE });
    if (!row) {
      throw Errors.notFound();
    }
    return row;
  }
}
