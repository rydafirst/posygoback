import { Module } from "@nestjs/common";

import { FinanceModule } from "../finance/finance.module";
import { AdminTaxController } from "./tax.controller";
import { TaxJobs } from "./tax.jobs";
import { TaxObligationsService } from "./tax-obligations.service";
import { TaxRemindersService } from "./tax-reminders.service";
import { TaxThresholdsService } from "./tax-thresholds.service";

@Module({ imports: [FinanceModule], controllers: [AdminTaxController], providers: [TaxObligationsService, TaxThresholdsService, TaxRemindersService, TaxJobs] })
export class TaxModule {}
