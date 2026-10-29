import { Module } from "@nestjs/common";

import { FilesModule } from "../files/files.module";
import { PartnerOperationsModule } from "../partners/operations/partner-operations.module";
import { FinanceModule } from "../finance/finance.module";
import { OnboardingModule } from "../onboarding/onboarding.module";
import { InventoryLedgerService } from "../stock/inventory/inventory-ledger.service";
import { CarrierAccountsService } from "./carriers/carrier-accounts.service";
import { OrderAlertsService } from "./core/order-alerts.service";
import { OrderCancellationService } from "./core/order-cancellation.service";
import { OrderChargesService } from "./core/order-charges.service";
import { OrderCreationService } from "./core/order-creation.service";
import { WarehouseChooserService } from "./core/warehouse-chooser.service";
import { LabelRecordsService } from "./core/label-records.service";
import { OrderShippingService } from "./core/order-shipping.service";
import { OrderTimelineService } from "./core/order-timeline.service";
import { OrderTrackingService } from "./core/order-tracking.service";
import { ShippingEstimateService } from "./core/shipping-estimate.service";
import { OrdersRepository } from "./core/orders.repository";
import { StockAllocationService } from "./core/stock-allocation.service";
import { ApiKeyGuard } from "./integration/api-key.guard";
import { ApiKeysService } from "./integration/api-keys.service";
import { IntegrationOrdersService } from "./integration/integration-orders.service";
import { IntegrationOrdersController, PackagingController, TrackingController, VendorApiKeysController, VendorOrdersController, WarehouseOrdersController } from "./orders.controllers";
import { PackagingService } from "./packaging/packaging.service";
import { OrderImportService } from "./vendor/order-import.service";
import { VendorOrdersService } from "./vendor/vendor-orders.service";
import { DispatchEvidenceService } from "./warehouse/dispatch-evidence.service";
import { FulfilmentService } from "./warehouse/fulfilment.service";

@Module({
  imports: [PartnerOperationsModule, FinanceModule, OnboardingModule, FilesModule],
  controllers: [VendorOrdersController, VendorApiKeysController, WarehouseOrdersController, PackagingController, IntegrationOrdersController, TrackingController],
  providers: [
    ShippingEstimateService,
    InventoryLedgerService,
    CarrierAccountsService,
    OrdersRepository,
    OrderTimelineService,
    OrderAlertsService,
    StockAllocationService,
    OrderChargesService,
    OrderCreationService,
    WarehouseChooserService,
    OrderShippingService,
    LabelRecordsService,
    OrderCancellationService,
    OrderTrackingService,
    VendorOrdersService,
    OrderImportService,
    FulfilmentService,
    DispatchEvidenceService,
    PackagingService,
    ApiKeysService,
    ApiKeyGuard,
    IntegrationOrdersService,
  ],
  exports: [CarrierAccountsService, OrderCreationService, WarehouseChooserService, OrdersRepository],
})
export class OrdersModule {}
