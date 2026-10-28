import { Body, Controller, Get, Headers, HttpCode, HttpStatus, Param, ParseUUIDPipe, Post, Put, Query, Req } from "@nestjs/common";
import type { RawBodyRequest } from "@nestjs/common";
import { Throttle } from "@nestjs/throttler";
import type { Request } from "express";
import { z } from "zod";

import type { AuthPrincipal, RequestMeta } from "../../common/auth/auth-principal";
import { CurrentPrincipal, Meta, Public, RequirePermission } from "../../common/auth/decorators";
import { type SellerCountry, SelectedCountry } from "../../common/auth/selected-country";
import { Errors } from "../../common/http/app-exception";
import { ZodValidationPipe } from "../../common/http/zod-validation.pipe";
import { THROTTLE } from "../../infrastructure/rate-limit/rate-limit.module";
import {
  ADJUSTMENT_STATUSES,
  type AdjustmentDecisionInput,
  adjustmentDecisionSchema,
  type AdjustmentStatus,
  type FeeScheduleDecisionInput,
  feeScheduleDecisionSchema,
  type ProposeFeeScheduleInput,
  proposeFeeScheduleSchema,
  type RequestAdjustmentInput,
  requestAdjustmentSchema,
  type StartTopUpInput,
  startTopUpSchema,
  WALLET_STATUSES,
  type WalletSettingsInput,
  walletSettingsSchema,
  vendorFeeSchedule,
  type VendorFeesView,
  type WalletStatus,
} from "../../shared";
import { AdjustmentsService } from "./adjustments/adjustments.service";
import { FeeSchedulesService } from "./fees/fee-schedules.service";
import { ReconciliationService } from "./jobs/reconciliation.service";
import { PaymentAccountsService } from "./payments/payment-accounts.service";
import { PaymentEventsService } from "./payments/payment-events.service";
import { PaymentEventNotReady, WebhookSignatureError } from "./payments/payment-processor.port";
import { TopUpsService } from "./payments/top-ups.service";
import { FinanceWalletsService } from "./wallets/finance-wallets.service";
import { WalletsService } from "./wallets/wallets.service";

const uuid = new ParseUUIDPipe({ version: "4" });
const countryParam = new ZodValidationPipe(z.string().regex(/^[A-Z]{2}$/));
const freezeBody = new ZodValidationPipe(z.object({ frozen: z.boolean(), reason: z.string().trim().min(10).max(300) }));
const walletFilters = new ZodValidationPipe(
  z.object({
    countryCode: z
      .string()
      .regex(/^[A-Z]{2}$/)
      .optional(),
    status: z.enum(WALLET_STATUSES).optional(),
  }),
);
const adjustmentFilter = new ZodValidationPipe(z.enum(ADJUSTMENT_STATUSES).optional());

@Controller({ path: "vendor/wallet", version: "1" })
export class VendorWalletController {
  constructor(
    private readonly wallets: WalletsService,
    private readonly topUps: TopUpsService,
  ) {}

  @RequirePermission("vendor.wallet.read")
  @Get()
  view(@SelectedCountry() country: SellerCountry) {
    return this.wallets.mine(country);
  }

  @RequirePermission("vendor.wallet.read")
  @Get("ledger")
  ledger(@SelectedCountry() country: SellerCountry) {
    return this.wallets.myLedger(country);
  }

  @RequirePermission("vendor.wallet.manage")
  @Put("settings")
  settings(
    @Body(new ZodValidationPipe(walletSettingsSchema)) input: WalletSettingsInput,
    @SelectedCountry() country: SellerCountry,
    @CurrentPrincipal() principal: AuthPrincipal,
    @Meta() meta: RequestMeta,
  ) {
    return this.wallets.updateSettings(principal, country, input.lowBalanceThresholdMinor, meta);
  }

  @RequirePermission("vendor.wallet.read")
  @Get("top-ups")
  topUpsList(@SelectedCountry() country: SellerCountry) {
    return this.topUps.list(country);
  }

  @RequirePermission("vendor.wallet.manage")
  @Post("top-ups/quote")
  @HttpCode(HttpStatus.OK)
  quote(@Body(new ZodValidationPipe(startTopUpSchema)) input: StartTopUpInput, @SelectedCountry() country: SellerCountry) {
    return this.topUps.quote(country, input.amountMinor);
  }

  @RequirePermission("vendor.wallet.manage")
  @Throttle(THROTTLE.authStrict)
  @Post("top-ups")
  start(@Body(new ZodValidationPipe(startTopUpSchema)) input: StartTopUpInput, @SelectedCountry() country: SellerCountry, @CurrentPrincipal() principal: AuthPrincipal, @Meta() meta: RequestMeta) {
    return this.topUps.start(principal, country, input.amountMinor, meta);
  }

  @RequirePermission("vendor.wallet.manage")
  @Throttle(THROTTLE.authStrict)
  @Post("top-ups/:id/sandbox-pay")
  @HttpCode(HttpStatus.OK)
  sandboxPay(@Param("id", uuid) id: string, @SelectedCountry() country: SellerCountry) {
    return this.topUps.completeSandbox(country, id);
  }
}

@Controller({ path: "vendor/fees", version: "1" })
export class VendorFeesController {
  constructor(private readonly fees: FeeSchedulesService) {}

  @RequirePermission("vendor.portal.access")
  @Get()
  async current(@SelectedCountry() country: SellerCountry): Promise<VendorFeesView> {
    const { currency, schedule } = await this.fees.active(country.countryCode);
    return { currency, schedule: vendorFeeSchedule(schedule) };
  }
}

@Controller({ path: "admin/fee-schedules", version: "1" })
export class AdminFeeSchedulesController {
  constructor(private readonly fees: FeeSchedulesService) {}

  @RequirePermission("fees.read")
  @Get(":countryCode")
  history(@Param("countryCode", countryParam) countryCode: string, @CurrentPrincipal() principal: AuthPrincipal) {
    return this.fees.history(principal, countryCode);
  }

  @RequirePermission("fees.propose")
  @Post(":countryCode")
  propose(
    @Param("countryCode", countryParam) countryCode: string,
    @Body(new ZodValidationPipe(proposeFeeScheduleSchema)) input: ProposeFeeScheduleInput,
    @CurrentPrincipal() principal: AuthPrincipal,
    @Meta() meta: RequestMeta,
  ) {
    return this.fees.propose(principal, countryCode, input, meta);
  }

  @RequirePermission("fees.approve")
  @Post("decisions/:id")
  @HttpCode(HttpStatus.OK)
  decide(
    @Param("id", uuid) id: string,
    @Body(new ZodValidationPipe(feeScheduleDecisionSchema)) input: FeeScheduleDecisionInput,
    @CurrentPrincipal() principal: AuthPrincipal,
    @Meta() meta: RequestMeta,
  ) {
    return this.fees.decide(principal, id, input, meta);
  }
}

@Controller({ path: "admin/finance", version: "1" })
export class AdminFinanceController {
  constructor(
    private readonly wallets: FinanceWalletsService,
    private readonly adjustments: AdjustmentsService,
    private readonly reconciliation: ReconciliationService,
  ) {}

  @RequirePermission("finance.read")
  @Get("wallets")
  list(@Query(walletFilters) filters: { countryCode?: string; status?: WalletStatus }) {
    return this.wallets.list(filters);
  }

  @RequirePermission("finance.read")
  @Get("wallets/:id")
  detail(@Param("id", uuid) id: string) {
    return this.wallets.detail(id);
  }

  @RequirePermission("finance.approve")
  @Post("wallets/:id/status")
  @HttpCode(HttpStatus.OK)
  setFrozen(@Param("id", uuid) id: string, @Body(freezeBody) input: { frozen: boolean; reason: string }, @CurrentPrincipal() principal: AuthPrincipal, @Meta() meta: RequestMeta) {
    return this.wallets.setFrozen(principal, id, input.frozen, input.reason, meta);
  }

  @RequirePermission("finance.read")
  @Get("adjustments")
  adjustmentsList(@Query("status", adjustmentFilter) status?: AdjustmentStatus) {
    return this.adjustments.list(status);
  }

  @RequirePermission("finance.adjust")
  @Throttle(THROTTLE.auth)
  @Post("wallets/:id/adjustments")
  requestAdjustment(
    @Param("id", uuid) id: string,
    @Body(new ZodValidationPipe(requestAdjustmentSchema)) input: RequestAdjustmentInput,
    @CurrentPrincipal() principal: AuthPrincipal,
    @Meta() meta: RequestMeta,
  ) {
    return this.adjustments.request(principal, id, input, meta);
  }

  @RequirePermission("finance.approve")
  @Post("adjustments/:id/decision")
  @HttpCode(HttpStatus.OK)
  decideAdjustment(
    @Param("id", uuid) id: string,
    @Body(new ZodValidationPipe(adjustmentDecisionSchema)) input: AdjustmentDecisionInput,
    @CurrentPrincipal() principal: AuthPrincipal,
    @Meta() meta: RequestMeta,
  ) {
    return this.adjustments.decide(principal, id, input, meta);
  }

  @RequirePermission("finance.read")
  @Get("reconciliation")
  reports() {
    return this.wallets.reconciliationReports();
  }

  @RequirePermission("finance.approve")
  @Throttle(THROTTLE.authStrict)
  @Post("reconciliation")
  @HttpCode(HttpStatus.OK)
  runReconciliation() {
    return this.reconciliation.run();
  }
}

@Controller({ path: "webhooks", version: "1" })
export class PaymentWebhooksController {
  constructor(
    private readonly accounts: PaymentAccountsService,
    private readonly events: PaymentEventsService,
  ) {}

  @Public()
  @Throttle({ default: { limit: 600, ttl: 60_000 } })
  @Post("stripe/:accountKey")
  @HttpCode(HttpStatus.OK)
  async stripe(@Param("accountKey", countryParam) accountKey: string, @Req() request: RawBodyRequest<Request>, @Headers() headers: Record<string, string>) {
    const resolved = this.accounts.find(accountKey);
    if (!resolved || resolved.account.processor !== "STRIPE" || !request.rawBody) {
      throw Errors.notFound();
    }
    try {
      const event = resolved.processor.parseWebhook(request.rawBody, headers);
      await this.events.handle("STRIPE", accountKey, event);
      return { received: true };
    } catch (error) {
      if (error instanceof WebhookSignatureError) {
        throw Errors.validation({ signature: ["Signature could not be verified"] });
      }
      if (error instanceof PaymentEventNotReady) {
        throw Errors.paymentNotReady();
      }
      throw error;
    }
  }
}
