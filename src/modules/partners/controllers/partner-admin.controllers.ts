import { Body, Controller, Get, HttpCode, HttpStatus, Param, ParseUUIDPipe, Post, Put, Query } from "@nestjs/common";
import { Throttle } from "@nestjs/throttler";
import { z, type ZodType } from "zod";

import type { AuthPrincipal, RequestMeta } from "../../../common/auth/auth-principal";
import { CurrentPrincipal, Meta, RequirePermission } from "../../../common/auth/decorators";
import { ZodValidationPipe } from "../../../common/http/zod-validation.pipe";
import { THROTTLE } from "../../../infrastructure/rate-limit/rate-limit.module";
import {
  assessMysterySchema,
  assignWarehouseSchema,
  type CreateMysteryOrderInput,
  createMysteryOrderSchema,
  PARTNER_CHECK_KINDS,
  PARTNER_DECISIONS,
  PARTNER_STATUSES,
  type PartnerCheckKind,
  type PartnerDecision,
  partnerDecisionSchema,
  partnerRequirementsSchema,
  type PartnerStatus,
  partnerTeamInviteSchema,
  payoutDecisionSchema,
  recordCallSchema,
  type RecordSecurityInput,
  recordSecuritySchema,
  releaseSecuritySchema,
  requestPayoutSchema,
  type RequestStockCountInput,
  requestStockCountSchema,
  resolveStockCountSchema,
  type ReviewCheckInput,
  reviewCheckSchema,
  scheduleCallSchema,
  setTierSchema,
  type StatementRange,
  statementRangeSchema,
} from "../../../shared";
import { AdminPartnersService } from "../admin/admin-partners.service";
import { PartnerFinanceService } from "../admin/partner-finance.service";
import { PartnerReviewsService } from "../admin/partner-reviews.service";
import { PartnerStatementService } from "../ledger/partner-statement.service";
import { MysteryOrdersService } from "../trust/mystery-orders.service";
import { PartnerScorecardService } from "../trust/partner-scorecard.service";
import { PartnerSecuritiesService } from "../admin/partner-securities.service";
import { StockCountsService } from "../trust/stock-counts.service";

const uuid = new ParseUUIDPipe({ version: "4" });
const body = <Output>(schema: ZodType<Output>) => new ZodValidationPipe(schema);
const checkKind = body(z.enum(PARTNER_CHECK_KINDS));
const decisionParam = body(z.enum(PARTNER_DECISIONS));
const statusFilter = body(z.enum(PARTNER_STATUSES).optional());
const payoutStatusFilter = body(z.enum(["PENDING_APPROVAL", "PROCESSING", "PAID", "FAILED", "REJECTED"]).optional());
const countFilters = body(z.object({ partnerId: z.string().uuid().optional(), status: z.enum(["REQUESTED", "MATCHED", "FLAGGED", "MISSED"]).optional() }));
const partnerFilter = body(z.string().uuid().optional());

@Controller({ path: "admin/partners", version: "1" })
export class AdminPartnersController {
  constructor(
    private readonly partners: AdminPartnersService,
    private readonly reviews: PartnerReviewsService,
    private readonly finance: PartnerFinanceService,
    private readonly statements: PartnerStatementService,
    private readonly scorecards: PartnerScorecardService,
    private readonly securities: PartnerSecuritiesService,
    private readonly counts: StockCountsService,
    private readonly mystery: MysteryOrdersService,
  ) {}

  @RequirePermission("partners.read")
  @Get()
  list(@CurrentPrincipal() principal: AuthPrincipal, @Query("status", statusFilter) status?: PartnerStatus) {
    return this.partners.list(principal, status);
  }

  @RequirePermission("partners.read")
  @Get(":id")
  detail(@Param("id", uuid) id: string, @CurrentPrincipal() principal: AuthPrincipal) {
    return this.partners.detail(principal, id);
  }

  @RequirePermission("partners.read")
  @Get(":id/scorecard")
  async scorecard(@Param("id", uuid) id: string, @CurrentPrincipal() principal: AuthPrincipal) {
    await this.partners.scoped(principal, id);
    return this.scorecards.scorecard(id);
  }

  @RequirePermission("partners.manage")
  @Throttle(THROTTLE.authStrict)
  @Post(":id/lead-invitations")
  @HttpCode(HttpStatus.ACCEPTED)
  async inviteLead(@Param("id", uuid) id: string, @Body(body(partnerTeamInviteSchema)) input: { email: string }, @CurrentPrincipal() principal: AuthPrincipal, @Meta() meta: RequestMeta) {
    await this.partners.inviteLead(principal, id, input.email, meta);
    return { status: "INVITED" };
  }

  @RequirePermission("partners.manage")
  @Put(":id/requirements")
  requirements(
    @Param("id", uuid) id: string,
    @Body(body(partnerRequirementsSchema))
    input: { requiredDepositMinor: number; requiredInsuranceMinor: number },
    @CurrentPrincipal() principal: AuthPrincipal,
    @Meta() meta: RequestMeta,
  ) {
    return this.partners.setRequirements(principal, id, input, meta);
  }

  @RequirePermission("partners.manage")
  @Put(":id/tier")
  tier(@Param("id", uuid) id: string, @Body(body(setTierSchema)) input: { level: number; reason: string }, @CurrentPrincipal() principal: AuthPrincipal, @Meta() meta: RequestMeta) {
    return this.partners.setTier(principal, id, input.level, input.reason, meta);
  }

  @RequirePermission("partners.manage")
  @Post(":id/warehouses")
  assignWarehouse(@Param("id", uuid) id: string, @Body(body(assignWarehouseSchema)) input: { warehouseId: string }, @CurrentPrincipal() principal: AuthPrincipal, @Meta() meta: RequestMeta) {
    return this.partners.assignWarehouse(principal, id, input.warehouseId, meta);
  }

  @RequirePermission("partners.review")
  @Post(":id/decisions/:decision")
  decide(
    @Param("id", uuid) id: string,
    @Param("decision", decisionParam) decision: PartnerDecision,
    @Body(body(partnerDecisionSchema)) input: { reason: string },
    @CurrentPrincipal() principal: AuthPrincipal,
    @Meta() meta: RequestMeta,
  ) {
    return this.partners.decide(principal, id, decision, input.reason, meta);
  }

  @RequirePermission("partners.review")
  @Post(":id/checks/:kind/review")
  reviewCheck(
    @Param("id", uuid) id: string,
    @Param("kind", checkKind) kind: PartnerCheckKind,
    @Body(body(reviewCheckSchema)) input: ReviewCheckInput,
    @CurrentPrincipal() principal: AuthPrincipal,
    @Meta() meta: RequestMeta,
  ) {
    return this.reviews.reviewCheck(principal, id, kind, input, meta);
  }

  @RequirePermission("partners.review")
  @Post(":id/storage-call")
  scheduleCall(@Param("id", uuid) id: string, @Body(body(scheduleCallSchema)) input: { scheduledAt: string }, @CurrentPrincipal() principal: AuthPrincipal, @Meta() meta: RequestMeta) {
    return this.reviews.scheduleCall(principal, id, input.scheduledAt, meta);
  }

  @RequirePermission("partners.review")
  @Post(":id/storage-call/outcome")
  recordCall(@Param("id", uuid) id: string, @Body(body(recordCallSchema)) input: { outcome: string }, @CurrentPrincipal() principal: AuthPrincipal, @Meta() meta: RequestMeta) {
    return this.reviews.recordCall(principal, id, input.outcome, meta);
  }

  @RequirePermission("partners.review")
  @Post(":id/insurance/:policyId/review")
  reviewInsurance(
    @Param("id", uuid) id: string,
    @Param("policyId", uuid) policyId: string,
    @Body(body(reviewCheckSchema)) input: ReviewCheckInput,
    @CurrentPrincipal() principal: AuthPrincipal,
    @Meta() meta: RequestMeta,
  ) {
    return this.reviews.reviewInsurance(principal, id, policyId, input, meta);
  }

  @RequirePermission("partners.review")
  @Get(":id/files/:fileId")
  evidence(@Param("id", uuid) id: string, @Param("fileId", uuid) fileId: string, @CurrentPrincipal() principal: AuthPrincipal, @Meta() meta: RequestMeta) {
    return this.reviews.evidenceUrl(principal, id, fileId, meta);
  }

  @RequirePermission("partners.finance")
  @Post(":id/securities")
  recordSecurity(@Param("id", uuid) id: string, @Body(body(recordSecuritySchema)) input: RecordSecurityInput, @CurrentPrincipal() principal: AuthPrincipal, @Meta() meta: RequestMeta) {
    return this.securities.recordSecurity(principal, id, input, meta);
  }

  @RequirePermission("partners.finance")
  @Post(":id/securities/:securityId/confirm")
  confirmSecurity(@Param("id", uuid) id: string, @Param("securityId", uuid) securityId: string, @CurrentPrincipal() principal: AuthPrincipal, @Meta() meta: RequestMeta) {
    return this.securities.confirmSecurity(principal, id, securityId, meta);
  }

  @RequirePermission("partners.finance")
  @Post(":id/securities/:securityId/release")
  releaseSecurity(
    @Param("id", uuid) id: string,
    @Param("securityId", uuid) securityId: string,
    @Body(body(releaseSecuritySchema)) input: { note: string },
    @CurrentPrincipal() principal: AuthPrincipal,
    @Meta() meta: RequestMeta,
  ) {
    return this.securities.releaseSecurity(principal, id, securityId, input.note, meta);
  }

  @RequirePermission("partners.finance")
  @Post(":id/payouts")
  requestPayout(@Param("id", uuid) id: string, @Body(body(requestPayoutSchema)) input: { amountMinor: number; note: string }, @CurrentPrincipal() principal: AuthPrincipal, @Meta() meta: RequestMeta) {
    return this.finance.requestPayout(principal, id, input, meta);
  }

  @RequirePermission("partners.finance")
  @Get(":id/statement")
  async statement(@Param("id", uuid) id: string, @Query(body(statementRangeSchema)) query: StatementRange, @CurrentPrincipal() principal: AuthPrincipal) {
    await this.partners.scoped(principal, id);
    return this.statements.statement(id, query);
  }

  @RequirePermission("partners.review")
  @Post(":id/stock-counts")
  requestCount(@Param("id", uuid) id: string, @Body(body(requestStockCountSchema)) input: RequestStockCountInput, @CurrentPrincipal() principal: AuthPrincipal, @Meta() meta: RequestMeta) {
    return this.counts.request(principal, id, input, meta);
  }

  @RequirePermission("partners.manage")
  @Get(":id/mystery-orders/products")
  mysteryProducts(@Param("id", uuid) id: string, @CurrentPrincipal() principal: AuthPrincipal) {
    return this.mystery.stockedProducts(principal, id);
  }

  @RequirePermission("partners.manage")
  @Post(":id/mystery-orders")
  createMystery(@Param("id", uuid) id: string, @Body(body(createMysteryOrderSchema)) input: CreateMysteryOrderInput, @CurrentPrincipal() principal: AuthPrincipal, @Meta() meta: RequestMeta) {
    return this.mystery.create(principal, id, input, meta);
  }
}

@Controller({ path: "admin/partner-payouts", version: "1" })
export class AdminPartnerPayoutsController {
  constructor(private readonly finance: PartnerFinanceService) {}

  @RequirePermission("partners.finance")
  @Get()
  list(
    @CurrentPrincipal() principal: AuthPrincipal,
    @Query("status", payoutStatusFilter)
    status?: "PENDING_APPROVAL" | "PROCESSING" | "PAID" | "FAILED" | "REJECTED",
  ) {
    return this.finance.payouts(principal, status);
  }

  @RequirePermission("partners.finance")
  @Post(":id/decision")
  decide(@Param("id", uuid) id: string, @Body(body(payoutDecisionSchema)) input: { approve: boolean; note: string }, @CurrentPrincipal() principal: AuthPrincipal, @Meta() meta: RequestMeta) {
    return this.finance.decidePayout(principal, id, input, meta);
  }

  @RequirePermission("partners.finance")
  @Post(":id/retry")
  @HttpCode(HttpStatus.OK)
  retry(@Param("id", uuid) id: string, @CurrentPrincipal() principal: AuthPrincipal) {
    return this.finance.retryPayout(principal, id);
  }
}

@Controller({ path: "admin/stock-counts", version: "1" })
export class AdminStockCountsController {
  constructor(private readonly counts: StockCountsService) {}

  @RequirePermission("partners.read")
  @Get()
  list(
    @CurrentPrincipal() principal: AuthPrincipal,
    @Query(countFilters)
    filters: { partnerId?: string; status?: "REQUESTED" | "MATCHED" | "FLAGGED" | "MISSED" },
  ) {
    return this.counts.listForAdmin(principal, filters);
  }

  @RequirePermission("partners.read")
  @Get(":id")
  detail(@Param("id", uuid) id: string, @CurrentPrincipal() principal: AuthPrincipal) {
    return this.counts.adminView(principal, id);
  }

  @RequirePermission("partners.review")
  @Post(":id/resolve")
  @HttpCode(HttpStatus.OK)
  resolve(@Param("id", uuid) id: string, @Body(body(resolveStockCountSchema)) input: { note: string; openClaims: boolean }, @CurrentPrincipal() principal: AuthPrincipal, @Meta() meta: RequestMeta) {
    return this.counts.resolve(principal, id, input, meta);
  }
}

@Controller({ path: "admin/mystery-orders", version: "1" })
export class AdminMysteryOrdersController {
  constructor(private readonly mystery: MysteryOrdersService) {}

  @RequirePermission("partners.read")
  @Get()
  list(@CurrentPrincipal() principal: AuthPrincipal, @Query("partnerId", partnerFilter) partnerId?: string) {
    return this.mystery.list(principal, partnerId);
  }

  @RequirePermission("partners.review")
  @Post(":orderId/assessment")
  @HttpCode(HttpStatus.OK)
  assess(@Param("orderId", uuid) orderId: string, @Body(body(assessMysterySchema)) input: { passed: boolean; note: string }, @CurrentPrincipal() principal: AuthPrincipal, @Meta() meta: RequestMeta) {
    return this.mystery.assess(principal, orderId, input.passed, input.note, meta);
  }
}
