import { Module } from "@nestjs/common";

import { CountriesModule } from "../countries/countries.module";
import { FinanceModule } from "../finance/finance.module";
import { FilesModule } from "../files/files.module";
import { ActivationFeesService } from "./activation/activation-fees.service";
import { ActivationNoticesService } from "./activation/activation-notices.service";
import { ActivationPaymentsService } from "./activation/activation-payments.service";
import { AdminActivationFeesController, VendorActivationController } from "./activation/activation.controllers";
import { AdminLegalController, PublicLegalController, VendorAgreementsController } from "./agreements/agreements.controllers";
import { AgreementsService } from "./agreements/agreements.service";
import { LegalDocumentsRepository } from "./agreements/legal-documents.repository";
import { MarketsService } from "./markets/markets.service";
import { InvitationsService } from "./team/invitations.service";
import { InvitationsController, MarketsController, TeamController } from "./team/team.controllers";
import { TeamService } from "./team/team.service";
import { VendorActivationService } from "./vendor-activation.service";
import { VendorStandingService } from "./vendor-standing.service";
import { IdentityProviderRegistry } from "./verification/identity-provider";
import { VendorVerificationService } from "./verification/vendor-verification.service";
import { AdminVerificationsController, VendorVerificationController } from "./verification/verification.controllers";
import { VerificationReviewService } from "./verification/verification-review.service";
import { VerificationStore } from "./verification/verification.store";

@Module({
  imports: [CountriesModule, FilesModule, FinanceModule],
  controllers: [
    VendorVerificationController,
    AdminVerificationsController,
    VendorAgreementsController,
    PublicLegalController,
    AdminLegalController,
    TeamController,
    InvitationsController,
    MarketsController,
    VendorActivationController,
    AdminActivationFeesController,
  ],
  providers: [
    VerificationStore,
    IdentityProviderRegistry,
    VendorVerificationService,
    VerificationReviewService,
    VendorActivationService,
    LegalDocumentsRepository,
    AgreementsService,
    TeamService,
    InvitationsService,
    MarketsService,
    VendorStandingService,
    ActivationNoticesService,
    ActivationPaymentsService,
    ActivationFeesService,
  ],
  exports: [VendorStandingService],
})
export class OnboardingModule {}
