import { Module } from "@nestjs/common";

import { FinanceModule } from "../finance/finance.module";
import { AdminReferralsController, VendorReferralsController } from "./growth.controllers";
import { GrowthJobs } from "./growth.jobs";
import { ReferralAdminService } from "./referral-admin.service";
import { ReferralRewardsService } from "./referral-rewards.service";
import { ReferralsService } from "./referrals.service";

@Module({ imports: [FinanceModule], controllers: [VendorReferralsController, AdminReferralsController], providers: [ReferralsService, ReferralRewardsService, ReferralAdminService, GrowthJobs] })
export class GrowthModule {}
