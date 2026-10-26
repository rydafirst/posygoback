import { Module } from "@nestjs/common";

import { FilesModule } from "../files/files.module";
import { FinanceModule } from "../finance/finance.module";
import { OnboardingModule } from "../onboarding/onboarding.module";
import { InventoryLedgerService } from "../stock/inventory/inventory-ledger.service";
import { ReturnFeesService } from "./return-fees.service";
import { ReturnUpkeepService } from "./return-upkeep.service";
import { VendorReturnsController, WarehouseReturnsController } from "./returns.controllers";
import { VendorReturnsRepository } from "./vendor-returns.repository";
import { VendorReturnsService } from "./vendor-returns.service";
import { WarehouseReturnsService } from "./warehouse-returns.service";

@Module({
  imports: [FilesModule, FinanceModule, OnboardingModule],
  controllers: [VendorReturnsController, WarehouseReturnsController],
  providers: [InventoryLedgerService, VendorReturnsRepository, ReturnFeesService, VendorReturnsService, WarehouseReturnsService, ReturnUpkeepService],
})
export class ReturnsModule {}
