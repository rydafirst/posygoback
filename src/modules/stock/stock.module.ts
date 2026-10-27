import { Module } from "@nestjs/common";

import { PartnerOperationsModule } from "../partners/operations/partner-operations.module";
import { FilesModule } from "../files/files.module";
import { FinanceModule } from "../finance/finance.module";
import { OnboardingModule } from "../onboarding/onboarding.module";
import { CatalogueController } from "./catalogue/catalogue.controller";
import { CatalogueService } from "./catalogue/catalogue.service";
import { VendorInboundController, WarehouseInboundController } from "./inbound/inbound.controllers";
import { InboundAlertsService } from "./inbound/inbound-alerts.service";
import { InboundChargesService } from "./inbound/inbound-charges.service";
import { InboundRepository } from "./inbound/inbound.repository";
import { ReceivingService } from "./inbound/receiving.service";
import { VendorInboundService } from "./inbound/vendor-inbound.service";
import { WarehouseInboundService } from "./inbound/warehouse-inbound.service";
import { VendorInventoryController, WarehouseInventoryController } from "./inventory/inventory.controllers";
import { InventoryLedgerService } from "./inventory/inventory-ledger.service";
import { InventoryService } from "./inventory/inventory.service";
import { WarehouseAccessService } from "./warehouses/warehouse-access.service";
import { WarehousesController } from "./warehouses/warehouses.controller";
import { WarehousesService } from "./warehouses/warehouses.service";

@Module({
  imports: [PartnerOperationsModule, FilesModule, OnboardingModule, FinanceModule],
  controllers: [WarehousesController, CatalogueController, VendorInboundController, WarehouseInboundController, VendorInventoryController, WarehouseInventoryController],
  providers: [
    WarehouseAccessService,
    WarehousesService,
    CatalogueService,
    InboundRepository,
    InboundChargesService,
    InboundAlertsService,
    VendorInboundService,
    WarehouseInboundService,
    ReceivingService,
    InventoryLedgerService,
    InventoryService,
  ],
  exports: [InventoryLedgerService, WarehouseAccessService],
})
export class StockModule {}
