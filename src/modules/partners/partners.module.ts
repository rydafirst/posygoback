import { Module } from "@nestjs/common";

import { AuthModule } from "../auth/auth.module";
import { FilesModule } from "../files/files.module";
import { FinanceModule } from "../finance/finance.module";
import { OnboardingModule } from "../onboarding/onboarding.module";
import { OrdersModule } from "../orders/orders.module";
import { StockModule } from "../stock/stock.module";
import { StaffModule } from "../staff/staff.module";
import { AdminPartnersService } from "./admin/admin-partners.service";
import { PartnerFinanceService } from "./admin/partner-finance.service";
import { PartnerSecuritiesService } from "./admin/partner-securities.service";
import { PartnerReviewsService } from "./admin/partner-reviews.service";
import { AdminMysteryOrdersController, AdminPartnerPayoutsController, AdminPartnersController, AdminStockCountsController } from "./controllers/partner-admin.controllers";
import { HubStockCountsController, PartnerPortalController } from "./controllers/partner-portal.controllers";
import { PartnerPublicController, PartnerWebhooksController } from "./controllers/partner-public.controllers";
import {
  AdminClaimsController,
  AdminCustodyAlertsController,
  AdminPartnerTrustController,
  AdminTransfersController,
  PartnerCustodyController,
  PartnerTransfersController,
  VendorCustodyController,
  WarehouseTransfersController,
} from "./controllers/custody.controllers";
import { ClaimDecisionsService } from "./custody/claim-decisions.service";
import { ClaimSettlementService } from "./custody/claim-settlement.service";
import { ClaimsService } from "./custody/claims.service";
import { CustodyAlertsService } from "./custody/custody-alerts.service";
import { HubSignalsService } from "./custody/hub-signals.service";
import { TransferMovementsService } from "./custody/transfer-movements.service";
import { TransfersService } from "./custody/transfers.service";
import { CustodyUpkeepService } from "./jobs/custody-upkeep.service";
import { PartnerJobs } from "./jobs/partner.jobs";
import { PartnerUpkeepService } from "./jobs/partner-upkeep.service";
import { PartnerStatementService } from "./ledger/partner-statement.service";
import { PartnerOperationsModule } from "./operations/partner-operations.module";
import { PartnerNotifierService } from "./partner-notifier.service";
import { PartnerReadinessService } from "./partner-readiness.service";
import { PartnersRepository } from "./partners.repository";
import { PartnerAccessService } from "./portal/partner-access.service";
import { PartnerPayoutAccountService } from "./portal/partner-payout-account.service";
import { PartnerPortalService } from "./portal/partner-portal.service";
import { PartnerVerificationService } from "./portal/partner-verification.service";
import { ConnectAccountEvents } from "./providers/connect-account-events";
import { PAYOUT_GATEWAY } from "./providers/partner-services.port";
import { PARTNER_SERVICE_PROVIDERS } from "./providers/partner-services.providers";
import { PartnerApplicationsService } from "./public/partner-applications.service";
import { PartnerPublicService } from "./public/partner-public.service";
import { MysteryOrdersService } from "./trust/mystery-orders.service";
import { PartnerScorecardService } from "./trust/partner-scorecard.service";
import { StockCountFactoryService } from "./trust/stock-count-factory.service";
import { StockCountsService } from "./trust/stock-counts.service";
import { TrustService } from "./trust/trust.service";

@Module({
  imports: [AuthModule, FilesModule, FinanceModule, OnboardingModule, OrdersModule, StaffModule, PartnerOperationsModule, StockModule],
  controllers: [
    PartnerPublicController,
    PartnerWebhooksController,
    PartnerPortalController,
    HubStockCountsController,
    AdminPartnersController,
    AdminPartnerPayoutsController,
    AdminStockCountsController,
    AdminMysteryOrdersController,
    AdminClaimsController,
    AdminCustodyAlertsController,
    AdminTransfersController,
    AdminPartnerTrustController,
    PartnerCustodyController,
    PartnerTransfersController,
    WarehouseTransfersController,
    VendorCustodyController,
  ],
  providers: [
    ...PARTNER_SERVICE_PROVIDERS,
    ConnectAccountEvents,
    PartnersRepository,
    PartnerReadinessService,
    PartnerNotifierService,
    PartnerAccessService,
    AdminPartnersService,
    PartnerReviewsService,
    PartnerFinanceService,
    PartnerSecuritiesService,
    PartnerPortalService,
    PartnerVerificationService,
    PartnerPayoutAccountService,
    PartnerApplicationsService,
    PartnerPublicService,
    PartnerStatementService,
    PartnerScorecardService,
    StockCountsService,
    MysteryOrdersService,
    PartnerUpkeepService,
    PartnerJobs,
    StockCountFactoryService,
    TrustService,
    ClaimsService,
    ClaimSettlementService,
    ClaimDecisionsService,
    CustodyAlertsService,
    TransfersService,
    TransferMovementsService,
    HubSignalsService,
    CustodyUpkeepService,
  ],
  exports: [PartnerUpkeepService, CustodyUpkeepService, ConnectAccountEvents, PAYOUT_GATEWAY],
})
export class PartnersModule {}
