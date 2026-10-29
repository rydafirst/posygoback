import { Module } from "@nestjs/common";

import { PartnerEarningsService } from "../ledger/partner-earnings.service";
import { PartnerLedgerService } from "../ledger/partner-ledger.service";
import { PartnerNotifierService } from "../partner-notifier.service";
import { PartnerCapacityService } from "./partner-capacity.service";

@Module({ providers: [PartnerLedgerService, PartnerEarningsService, PartnerCapacityService, PartnerNotifierService], exports: [PartnerLedgerService, PartnerEarningsService, PartnerCapacityService, PartnerNotifierService] })
export class PartnerOperationsModule {}
