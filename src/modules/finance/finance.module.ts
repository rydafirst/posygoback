import { Module } from "@nestjs/common";

import { PartnerOperationsModule } from "../partners/operations/partner-operations.module";
import { AdjustmentsService } from "./adjustments/adjustments.service";
import { AdminFeeSchedulesController, AdminFinanceController, PaymentWebhooksController, VendorFeesController, VendorWalletController } from "./controllers";
import { FeeSchedulesService } from "./fees/fee-schedules.service";
import { FinanceJobs } from "./jobs/finance.jobs";
import { JobLockService } from "./jobs/job-lock.service";
import { ReconciliationService } from "./jobs/reconciliation.service";
import { StorageBillingService } from "./jobs/storage-billing.service";
import { PaymentAccountsService } from "./payments/payment-accounts.service";
import { OrderPaymentRouter } from "./payments/order-payment.router";
import { PaymentEventsService } from "./payments/payment-events.service";
import { TopUpsService } from "./payments/top-ups.service";
import { FinanceWalletsService } from "./wallets/finance-wallets.service";
import { WalletAlertsService } from "./wallets/wallet-alerts.service";
import { WalletLedgerService } from "./wallets/wallet-ledger.service";
import { WalletsService } from "./wallets/wallets.service";

@Module({
  imports: [PartnerOperationsModule],
  controllers: [VendorWalletController, VendorFeesController, AdminFeeSchedulesController, AdminFinanceController, PaymentWebhooksController],
  providers: [
    WalletLedgerService,
    WalletAlertsService,
    WalletsService,
    FinanceWalletsService,
    FeeSchedulesService,
    PaymentAccountsService,
    PaymentEventsService,
    OrderPaymentRouter,
    TopUpsService,
    AdjustmentsService,
    JobLockService,
    StorageBillingService,
    ReconciliationService,
    FinanceJobs,
  ],
  exports: [JobLockService, WalletLedgerService, WalletAlertsService, FeeSchedulesService, PaymentAccountsService, StorageBillingService, OrderPaymentRouter, PaymentEventsService],
})
export class FinanceModule {}
