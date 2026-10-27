import { randomUUID } from "node:crypto";

import { Inject, Injectable } from "@nestjs/common";

import type { RequestMeta } from "../../../common/auth/auth-principal";
import { Errors } from "../../../common/http/app-exception";
import { APP_CONFIG } from "../../../config/config.module";
import type { AppConfig } from "../../../config/config.schema";
import { lockRow, type DatabaseClient, PrismaService } from "../../../database/prisma.service";
import { AuditService, SYSTEM_ACTOR } from "../../../infrastructure/audit/audit.service";
import { SecretHasherService } from "../../../infrastructure/crypto/secret-hasher.service";
import { EMAIL_SENDER, type EmailSender } from "../../../infrastructure/email/email.port";
import { AttemptLimiterService } from "../../../infrastructure/rate-limit/attempt-limiter.service";
import { type CountryConfig, type DestinationView, prefixProblems, recipientProblems, type ShipTo, type ShoppingRequestInput, type ShoppingRequestView } from "../../../shared";
import { CountriesRepository } from "../../countries/countries.repository";
import { randomCode } from "../../stock/inbound/references";
import { StaffAlertsService } from "../../notifications/staff-alerts.service";
import { ShoppingEmails } from "./shopping-emails";
import { SHOPPING_INCLUDE, ShoppingRepository } from "./shopping.repository";

const PER_IP = { name: "shopping-request-ip", limit: 10, windowSeconds: 60 * 60 };
const PER_EMAIL = { name: "shopping-request-email", limit: 5, windowSeconds: 24 * 60 * 60 };
const OPEN_PER_BUYER = 5;
const BUYER_CANCELLABLE = ["REQUESTED", "QUOTED", "EXPIRED"] as const;
const CONFIRM_MS = 48 * 60 * 60 * 1000;

export interface Lane {
  customsRequired: boolean;
}

@Injectable()
export class ShoppingRequestsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly repository: ShoppingRepository,
    private readonly countries: CountriesRepository,
    private readonly limiter: AttemptLimiterService,
    private readonly hasher: SecretHasherService,
    private readonly audit: AuditService,
    @Inject(EMAIL_SENDER) private readonly email: EmailSender,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    private readonly staffAlerts: StaffAlertsService,
  ) {}

  async create(input: ShoppingRequestInput, meta: RequestMeta): Promise<{ reference: string }> {
    await this.limiter.consume(PER_IP, meta.ip);
    await this.limiter.consume(PER_EMAIL, input.buyerEmail);
    const country = await this.prisma.country.findUnique({ where: { code: input.countryCode } });
    if (!country || country.status !== "LIVE") {
      throw Errors.validation({ countryCode: ["We don't shop in that country yet"] });
    }
    await this.lane(this.prisma, input.countryCode, input.shipTo);
    const id = randomUUID();
    const reference = `SHP-${input.countryCode}-${randomCode(8)}`;
    const token = this.hasher.randomToken();
    await this.prisma.$transaction(async (tx) => {
      const buyer = await tx.buyerAccount.upsert({ where: { email: input.buyerEmail }, create: { email: input.buyerEmail, name: input.buyerName }, update: {} });
      const open = await tx.shoppingRequest.count({ where: { buyerId: buyer.id, status: { in: ["REQUESTED", "QUOTED"] }, confirmedAt: { not: null } } });
      if (open >= OPEN_PER_BUYER) {
        throw Errors.invalidTransition("You already have several requests waiting. Pay for or cancel one before sending another.");
      }
      await tx.shoppingRequest.create({
        data: {
          id,
          reference,
          countryCode: input.countryCode,
          currency: country.currency,
          buyerId: buyer.id,
          buyerEmail: input.buyerEmail,
          buyerName: input.buyerName,
          recipientEncrypted: this.repository.encryptShipTo(id, input.shipTo),
          recipientCity: input.shipTo.city,
          destinationCountryCode: input.shipTo.countryCode,
          notes: input.notes || null,
          confirmTokenHash: this.hasher.keyedHash(token),
          confirmExpiresAt: new Date(Date.now() + CONFIRM_MS),
          lines: { create: input.lines.map((line, position) => ({ position, url: line.url, description: line.description, quantity: line.quantity })) },
        },
      });
      await this.audit.record(
        {
          actor: { userId: null, role: null },
          action: "shopping.requested",
          resourceType: "shopping_request",
          resourceId: id,
          countryCode: input.countryCode,
          after: { reference, lines: input.lines.length },
          meta,
        },
        tx,
      );
    });
    const deliverTo = `${input.shipTo.name}, ${input.shipTo.city} ${input.shipTo.postalCode}, ${input.shipTo.countryCode}`;
    await this.email.send(ShoppingEmails.confirm(input.buyerEmail, reference, deliverTo, `${this.config.WEB_PUBLIC_URL}/shopping/confirm#token=${token}`)).catch(() => undefined);
    return { reference };
  }

  async confirm(token: string, meta: RequestMeta): Promise<{ reference: string }> {
    const now = new Date();
    const row = await this.prisma.shoppingRequest.findUnique({ where: { confirmTokenHash: this.hasher.keyedHash(token) } });
    if (!row || row.status !== "REQUESTED" || !row.confirmExpiresAt || row.confirmExpiresAt <= now) {
      throw Errors.notFound();
    }
    const confirmed = await this.prisma.shoppingRequest.updateMany({
      where: { id: row.id, status: "REQUESTED", confirmTokenHash: row.confirmTokenHash },
      data: { confirmedAt: now, confirmTokenHash: null, confirmExpiresAt: null },
    });
    if (confirmed.count === 0) {
      throw Errors.notFound();
    }
    await this.audit.record({ actor: SYSTEM_ACTOR, action: "shopping.confirmed", resourceType: "shopping_request", resourceId: row.id, countryCode: row.countryCode, meta });
    await this.email.send(ShoppingEmails.received(row.buyerEmail, row.reference, this.config.WEB_PUBLIC_URL)).catch(() => undefined);
    await this.staffAlerts.raise("shoppingToPrice", {
      countryCode: row.countryCode,
      title: `Shopping request ${row.reference} to price`,
      body: "The buyer has confirmed their request. Check the items and send them a price.",
    });
    return { reference: row.reference };
  }

  async expireUnconfirmed(now = new Date()): Promise<number> {
    const expired = await this.prisma.shoppingRequest.updateMany({
      where: { status: "REQUESTED", confirmedAt: null, confirmExpiresAt: { lt: now } },
      data: { status: "CANCELLED", cancelReason: "Not confirmed within 48 hours.", confirmTokenHash: null, confirmExpiresAt: null },
    });
    return expired.count;
  }

  async destinations(countryCode: string): Promise<DestinationView[]> {
    const country = await this.prisma.country.findUnique({ where: { code: countryCode } });
    if (!country || country.status !== "LIVE") {
      throw Errors.notFound();
    }
    return this.countries.enabledDestinations(countryCode);
  }

  async listForBuyer(buyerId: string): Promise<ShoppingRequestView[]> {
    const rows = await this.prisma.shoppingRequest.findMany({ where: { buyerId, confirmedAt: { not: null } }, include: SHOPPING_INCLUDE, orderBy: { createdAt: "desc" }, take: 50 });
    return rows.map((row) => this.repository.view(row, "BUYER"));
  }

  async buyerDetail(buyerId: string, requestId: string): Promise<ShoppingRequestView> {
    const row = await this.prisma.shoppingRequest.findFirst({ where: { id: requestId, buyerId, confirmedAt: { not: null } }, include: SHOPPING_INCLUDE });
    if (!row) {
      throw Errors.notFound();
    }
    return this.repository.view(row, "BUYER");
  }

  async cancelByBuyer(buyerId: string, requestId: string, meta: RequestMeta): Promise<ShoppingRequestView> {
    await this.buyerDetail(buyerId, requestId);
    await this.prisma.$transaction(async (tx) => {
      await lockRow(tx, "shoppingRequests", requestId);
      const cancelled = await tx.shoppingRequest.updateMany({
        where: { id: requestId, status: { in: [...BUYER_CANCELLABLE] } },
        data: { status: "CANCELLED", cancelReason: "You cancelled this request." },
      });
      if (cancelled.count === 0) {
        throw Errors.invalidTransition("This request has been paid for, so ask us to cancel it instead.");
      }
      await this.audit.record({ actor: { userId: null, role: null }, action: "shopping.cancelled_by_buyer", resourceType: "shopping_request", resourceId: requestId, after: { buyerId }, meta }, tx);
    });
    return this.buyerDetail(buyerId, requestId);
  }

  async lane(client: DatabaseClient, originCountryCode: string, shipTo: ShipTo): Promise<Lane> {
    const lane = await client.shippingLane.findFirst({
      where: { originCountryCode, destinationCountryCode: shipTo.countryCode, enabled: true },
      include: { destination: { select: { config: true } } },
    });
    if (!lane) {
      throw Errors.validation({ "shipTo.countryCode": ["We can't deliver there from this country yet"] });
    }
    const problems = prefixProblems(recipientProblems(shipTo, (lane.destination.config as unknown as CountryConfig).address, lane.customsRequired), "shipTo");
    if (Object.keys(problems).length > 0) {
      throw Errors.validation(problems);
    }
    return { customsRequired: lane.customsRequired };
  }
}
