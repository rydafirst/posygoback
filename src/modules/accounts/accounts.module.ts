import { Module } from "@nestjs/common";

import { AuthModule } from "../auth/auth.module";
import { FilesModule } from "../files/files.module";
import { OnboardingModule } from "../onboarding/onboarding.module";
import { AccountAccessService } from "./account-access.service";
import { AccountRemovalService } from "./account-removal.service";
import { AdminPartnerAccountsController, AdminVendorAccountsController } from "./accounts.controllers";

@Module({
  imports: [AuthModule, FilesModule, OnboardingModule],
  controllers: [AdminVendorAccountsController, AdminPartnerAccountsController],
  providers: [AccountAccessService, AccountRemovalService],
})
export class AccountsModule {}
