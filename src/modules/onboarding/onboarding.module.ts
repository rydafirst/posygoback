import { Module } from "@nestjs/common";

import { CountriesModule } from "../countries/countries.module";
import { FilesModule } from "../files/files.module";
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
  imports: [CountriesModule, FilesModule],
  controllers: [
    VendorVerificationController,
    AdminVerificationsController,
    VendorAgreementsController,
    PublicLegalController,
    AdminLegalController,
    TeamController,
    InvitationsController,
    MarketsController,
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
  ],
  exports: [VendorStandingService],
})
export class OnboardingModule {}
