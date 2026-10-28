import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, ParseUUIDPipe, Post, Put, Query } from "@nestjs/common";
import { Throttle } from "@nestjs/throttler";
import type { ZodType } from "zod";

import type { AuthPrincipal, RequestMeta } from "../../../common/auth/auth-principal";
import { CurrentPrincipal, Meta, RequirePermission } from "../../../common/auth/decorators";
import { ZodValidationPipe } from "../../../common/http/zod-validation.pipe";
import { THROTTLE } from "../../../infrastructure/rate-limit/rate-limit.module";
import {
  type InsurancePolicyInput,
  insurancePolicySchema,
  type PartnerProfileInput,
  partnerProfileSchema,
  partnerTeamInviteSchema,
  type ProofOfAddressInput,
  proofOfAddressSchema,
  type RefereeInput,
  refereeSchema,
  type SignAgreementInput,
  signAgreementSchema,
  type StatementRange,
  statementRangeSchema,
  type StorageSpaceInput,
  storageSpaceSchema,
  type SubmitStockCountInput,
  submitStockCountSchema,
  type WorkStatusInput,
  workStatusSchema,
} from "../../../shared";
import { PartnerStatementService } from "../ledger/partner-statement.service";
import { partnerIdOf } from "../portal/partner-access.service";
import { PartnerPayoutAccountService } from "../portal/partner-payout-account.service";
import { PartnerPortalService } from "../portal/partner-portal.service";
import { PartnerIdentityService } from "../portal/partner-identity.service";
import { PartnerVerificationService } from "../portal/partner-verification.service";
import { PartnerScorecardService } from "../trust/partner-scorecard.service";
import { StockCountsService } from "../trust/stock-counts.service";

const uuid = new ParseUUIDPipe({ version: "4" });
const body = <Output>(schema: ZodType<Output>) => new ZodValidationPipe(schema);

@Controller({ path: "partner", version: "1" })
export class PartnerPortalController {
  constructor(
    private readonly portal: PartnerPortalService,
    private readonly verification: PartnerVerificationService,
    private readonly identity: PartnerIdentityService,
    private readonly payouts: PartnerPayoutAccountService,
    private readonly statements: PartnerStatementService,
    private readonly scorecards: PartnerScorecardService,
  ) {}

  @RequirePermission("partner.profile.read")
  @Get()
  overview(@CurrentPrincipal() principal: AuthPrincipal) {
    return this.portal.overview(principal);
  }

  @RequirePermission("partner.statement.read")
  @Get("scorecard")
  scorecard(@CurrentPrincipal() principal: AuthPrincipal) {
    return this.scorecards.forPartner(partnerIdOf(principal));
  }

  @RequirePermission("partner.profile.manage")
  @Put("profile")
  async profile(@Body(body(partnerProfileSchema)) input: PartnerProfileInput, @CurrentPrincipal() principal: AuthPrincipal, @Meta() meta: RequestMeta) {
    await this.verification.updateProfile(principal, input, meta);
    return this.portal.overview(principal);
  }

  @RequirePermission("partner.profile.manage")
  @Put("referee")
  async referee(@Body(body(refereeSchema)) input: RefereeInput, @CurrentPrincipal() principal: AuthPrincipal, @Meta() meta: RequestMeta) {
    await this.verification.updateReferee(principal, input, meta);
    return this.portal.overview(principal);
  }

  @RequirePermission("partner.profile.manage")
  @Throttle(THROTTLE.authStrict)
  @Post("identity/session")
  @HttpCode(HttpStatus.OK)
  startIdentity(@CurrentPrincipal() principal: AuthPrincipal, @Meta() meta: RequestMeta) {
    return this.identity.start(principal, meta);
  }

  @RequirePermission("partner.profile.manage")
  @Post("identity/refresh")
  @HttpCode(HttpStatus.OK)
  async refreshIdentity(@CurrentPrincipal() principal: AuthPrincipal) {
    await this.identity.refresh(principal);
    return this.portal.overview(principal);
  }

  @RequirePermission("partner.profile.manage")
  @Put("verification/proof-of-address")
  async proof(@Body(body(proofOfAddressSchema)) input: ProofOfAddressInput, @CurrentPrincipal() principal: AuthPrincipal, @Meta() meta: RequestMeta) {
    await this.verification.submitProofOfAddress(principal, input, meta);
    return this.portal.overview(principal);
  }

  @RequirePermission("partner.profile.manage")
  @Put("verification/storage-space")
  async storage(@Body(body(storageSpaceSchema)) input: StorageSpaceInput, @CurrentPrincipal() principal: AuthPrincipal, @Meta() meta: RequestMeta) {
    await this.verification.submitStorageSpace(principal, input, meta);
    return this.portal.overview(principal);
  }

  @RequirePermission("partner.profile.manage")
  @Put("verification/work-status")
  async workStatus(@Body(body(workStatusSchema)) input: WorkStatusInput, @CurrentPrincipal() principal: AuthPrincipal, @Meta() meta: RequestMeta) {
    await this.verification.submitWorkStatus(principal, input, meta);
    return this.portal.overview(principal);
  }

  @RequirePermission("partner.profile.manage")
  @Throttle(THROTTLE.authStrict)
  @Post("agreement/sign")
  @HttpCode(HttpStatus.OK)
  async sign(@Body(body(signAgreementSchema)) input: SignAgreementInput, @CurrentPrincipal() principal: AuthPrincipal, @Meta() meta: RequestMeta) {
    await this.verification.signAgreement(principal, input, meta);
    return this.portal.overview(principal);
  }

  @RequirePermission("partner.profile.manage")
  @Throttle(THROTTLE.authStrict)
  @Post("payouts/setup")
  @HttpCode(HttpStatus.OK)
  setupPayouts(@CurrentPrincipal() principal: AuthPrincipal, @Meta() meta: RequestMeta) {
    return this.payouts.startSetup(principal, meta);
  }

  @RequirePermission("partner.profile.manage")
  @Post("payouts/refresh")
  @HttpCode(HttpStatus.OK)
  async refreshPayouts(@CurrentPrincipal() principal: AuthPrincipal) {
    await this.payouts.refreshOwn(principal);
    return this.portal.overview(principal);
  }

  @RequirePermission("partner.profile.manage")
  @Post("submit")
  @HttpCode(HttpStatus.OK)
  async submit(@CurrentPrincipal() principal: AuthPrincipal, @Meta() meta: RequestMeta) {
    await this.verification.submitForReview(principal, meta);
    return this.portal.overview(principal);
  }

  @RequirePermission("partner.profile.manage")
  @Post("insurance")
  async insurance(@Body(body(insurancePolicySchema)) input: InsurancePolicyInput, @CurrentPrincipal() principal: AuthPrincipal, @Meta() meta: RequestMeta) {
    await this.portal.addInsurance(principal, input, meta);
    return this.portal.overview(principal);
  }

  @RequirePermission("partner.team.manage")
  @Throttle(THROTTLE.authStrict)
  @Post("team/invitations")
  @HttpCode(HttpStatus.ACCEPTED)
  async invite(@Body(body(partnerTeamInviteSchema)) input: { email: string }, @CurrentPrincipal() principal: AuthPrincipal, @Meta() meta: RequestMeta) {
    await this.portal.inviteTeamMember(principal, input.email, meta);
    return { status: "INVITED" };
  }

  @RequirePermission("partner.team.manage")
  @Delete("team/invitations/:id")
  @HttpCode(HttpStatus.NO_CONTENT)
  revoke(@Param("id", uuid) id: string, @CurrentPrincipal() principal: AuthPrincipal, @Meta() meta: RequestMeta) {
    return this.portal.revokeInvitation(principal, id, meta);
  }

  @RequirePermission("partner.team.manage")
  @Post("team/members/:userId/suspend")
  @HttpCode(HttpStatus.NO_CONTENT)
  suspend(@Param("userId", uuid) userId: string, @CurrentPrincipal() principal: AuthPrincipal, @Meta() meta: RequestMeta) {
    return this.portal.suspendTeamMember(principal, userId, meta);
  }

  @RequirePermission("partner.statement.read")
  @Get("statement")
  statement(@Query(body(statementRangeSchema)) query: StatementRange, @CurrentPrincipal() principal: AuthPrincipal) {
    return this.statements.statement(partnerIdOf(principal), query);
  }
}

@Controller({ path: "warehouse/stock-counts", version: "1" })
export class HubStockCountsController {
  constructor(private readonly counts: StockCountsService) {}

  @RequirePermission("partner.profile.read")
  @Get()
  list(@CurrentPrincipal() principal: AuthPrincipal) {
    return this.counts.listForHub(principal);
  }

  @RequirePermission("partner.profile.read")
  @Post(":id/submit")
  @HttpCode(HttpStatus.OK)
  submit(@Param("id", uuid) id: string, @Body(body(submitStockCountSchema)) input: SubmitStockCountInput, @CurrentPrincipal() principal: AuthPrincipal, @Meta() meta: RequestMeta) {
    return this.counts.submit(principal, id, input, meta);
  }
}
