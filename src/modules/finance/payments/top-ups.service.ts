import { Inject, Injectable } from "@nestjs/common";

import type { AuthPrincipal, RequestMeta } from "../../../common/auth/auth-principal";
import { Errors } from "../../../common/http/app-exception";
import { APP_CONFIG } from "../../../config/config.module";
import type { AppConfig } from "../../../config/config.schema";
import { PrismaService } from "../../../database/prisma.service";
import { AuditService } from "../../../infrastructure/audit/audit.service";
import { currencyDefinition, grossUpForProcessorFees, Money, TOP_UP_LIMITS, type TopUpQuote, type TopUpStarted, type TopUpView } from "../../../shared";
import { UsersRepository } from "../../auth/users.repository";
import { vendorIdOf } from "../../onboarding/scope";
import { WalletLedgerService } from "../wallets/wallet-ledger.service";
import { PaymentAccountsService } from "./payment-accounts.service";
import { PaymentEventsService } from "./payment-events.service";

@Injectable()
export class TopUpsService {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    private readonly accounts: PaymentAccountsService,
    private readonly ledger: WalletLedgerService,
    private readonly events: PaymentEventsService,
    private readonly users: UsersRepository,
    private readonly audit: AuditService,
  ) {}

  async quote(principal: AuthPrincipal, amountMinor: number): Promise<TopUpQuote> {
    const { currency, feePercentBps, fixedFeeMinor } = await this.terms(principal);
    this.assertWithinLimits(amountMinor, currency);
    const grossMinor = grossUpForProcessorFees(amountMinor, feePercentBps, fixedFeeMinor);
    return { netMinor: amountMinor, grossMinor, feeMinor: grossMinor - amountMinor, currency };
  }

  async start(principal: AuthPrincipal, amountMinor: number, meta: RequestMeta): Promise<TopUpStarted> {
    const vendorId = vendorIdOf(principal);
    const quote = await this.quote(principal, amountMinor);
    const resolved = this.accounts.forCountry(principal.countryCode ?? "");
    const owner = await this.users.findById(principal.userId);
    const wallet = await this.ledger.walletFor(this.prisma, vendorId, quote.currency);
    const topUp = await this.prisma.$transaction(async (tx) => {
      const created = await tx.topUp.create({
        data: {
          walletId: wallet.id,
          vendorId,
          countryCode: resolved.countryCode,
          processor: resolved.processor.name,
          currency: quote.currency,
          netMinor: BigInt(quote.netMinor),
          grossMinor: BigInt(quote.grossMinor),
          feeMinor: BigInt(quote.feeMinor),
          createdBy: principal.userId,
        },
      });
      await this.audit.record(
        {
          actor: { userId: principal.userId, role: principal.role },
          action: "top_up.started",
          resourceType: "top_up",
          resourceId: created.id,
          vendorId,
          countryCode: resolved.countryCode,
          after: quote,
          meta,
        },
        tx,
      );
      return created;
    });
    const web = new URL(this.config.WEB_PUBLIC_URL).origin;
    const session = await resolved.processor.createCheckout({
      topUpId: topUp.id,
      currency: quote.currency,
      grossMinor: quote.grossMinor,
      description: `Wallet top-up of ${Money.of(quote.netMinor, quote.currency).format("en-GB")}`,
      customerEmail: owner?.email ?? "",
      successUrl: `${web}/wallet?topUp=${topUp.id}`,
      cancelUrl: `${web}/wallet?topUp=${topUp.id}&cancelled=1`,
    });
    await this.prisma.topUp.update({ where: { id: topUp.id }, data: { providerReference: session.providerReference } });
    return { topUpId: topUp.id, redirectUrl: session.redirectUrl, ...quote };
  }

  async list(principal: AuthPrincipal): Promise<TopUpView[]> {
    const rows = await this.prisma.topUp.findMany({ where: { vendorId: vendorIdOf(principal) }, orderBy: { createdAt: "desc" }, take: 50 });
    return rows.map((row) => ({
      id: row.id,
      status: row.status,
      netMinor: Number(row.netMinor),
      grossMinor: Number(row.grossMinor),
      feeMinor: Number(row.feeMinor),
      currency: row.currency,
      createdAt: row.createdAt.toISOString(),
    }));
  }

  async completeSandbox(principal: AuthPrincipal, topUpId: string): Promise<TopUpView[]> {
    const topUp = await this.prisma.topUp.findFirst({ where: { id: topUpId, vendorId: vendorIdOf(principal) } });
    if (!topUp || topUp.processor !== "SANDBOX" || this.config.NODE_ENV === "production" || !topUp.providerReference) {
      throw Errors.notFound();
    }
    await this.events.handle("SANDBOX", topUp.countryCode, {
      kind: "TOP_UP_PAID",
      eventId: `sandbox_paid_${topUp.id}`,
      topUpId: topUp.id,
      providerReference: topUp.providerReference,
      paymentId: `sandbox_payment_${topUp.id}`,
      amountMinor: Number(topUp.grossMinor),
      currency: topUp.currency,
      type: "sandbox.paid",
      payload: { topUpId },
    });
    return this.list(principal);
  }

  private async terms(principal: AuthPrincipal) {
    const country = await this.prisma.country.findUnique({ where: { code: principal.countryCode ?? "" } });
    if (!country) {
      throw Errors.notFound();
    }
    const { account } = this.accounts.forCountry(country.code);
    return { currency: country.currency, feePercentBps: account.feePercentBps, fixedFeeMinor: account.fixedFeeMinor };
  }

  private assertWithinLimits(amountMinor: number, currency: string): void {
    const factor = 10 ** currencyDefinition(currency).minorUnits;
    if (amountMinor < TOP_UP_LIMITS.minMajor * factor || amountMinor > TOP_UP_LIMITS.maxMajor * factor) {
      const format = (major: number) => Money.of(major * factor, currency).format("en-GB");
      throw Errors.validation({ amountMinor: [`Top up between ${format(TOP_UP_LIMITS.minMajor)} and ${format(TOP_UP_LIMITS.maxMajor)}`] });
    }
  }
}
