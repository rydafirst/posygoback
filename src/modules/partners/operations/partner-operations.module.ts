import { Module } from "@nestjs/common";

import { PartnerEarningsService } from "../ledger/partner-earnings.service";
import { PartnerLedgerService } from "../ledger/partner-ledger.service";
import { PartnerCapacityService } from "./partner-capacity.service";

@Module({ providers: [PartnerLedgerService, PartnerEarningsService, PartnerCapacityService], exports: [PartnerLedgerService, PartnerEarningsService, PartnerCapacityService] })
export class PartnerOperationsModule {}
