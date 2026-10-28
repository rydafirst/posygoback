import { Body, Controller, Get, HttpCode, HttpStatus, Injectable, Param, ParseUUIDPipe, Post, Query } from "@nestjs/common";
import { Throttle } from "@nestjs/throttler";
import { z, type ZodType } from "zod";

import type { AuthPrincipal, RequestMeta } from "../../../common/auth/auth-principal";
import { CurrentPrincipal, Meta, RequirePermission } from "../../../common/auth/decorators";
import { type SellerCountry, SelectedCountry } from "../../../common/auth/selected-country";
import { ZodValidationPipe } from "../../../common/http/zod-validation.pipe";
import { THROTTLE } from "../../../infrastructure/rate-limit/rate-limit.module";
import {
  type AssessClaimInput,
  assessClaimSchema,
  CLAIM_STATUSES,
  claimResponseSchema,
  type CreateTransferInput,
  createTransferSchema,
  type DecideClaimInput,
  decideClaimSchema,
  type DispatchTransferInput,
  dispatchTransferSchema,
  type ReceiveTransferInput,
  receiveTransferSchema,
  type ReportClaimInput,
  reportClaimSchema,
  resolveAlertSchema,
  TRANSFER_STATUSES,
} from "../../../shared";
import { AdminPartnersService } from "../admin/admin-partners.service";
import { ClaimDecisionsService } from "../custody/claim-decisions.service";
import { type ClaimFilters, ClaimsService } from "../custody/claims.service";
import { CustodyAlertsService } from "../custody/custody-alerts.service";
import { HubSignalsService } from "../custody/hub-signals.service";
import { TransferMovementsService } from "../custody/transfer-movements.service";
import { TransfersService } from "../custody/transfers.service";
import { partnerIdOf } from "../portal/partner-access.service";
import { TrustService } from "../trust/trust.service";

const uuid = new ParseUUIDPipe({ version: "4" });
const body = <Output>(schema: ZodType<Output>) => new ZodValidationPipe(schema);
const claimFilters = body(z.object({ status: z.enum(CLAIM_STATUSES).optional(), partnerId: z.string().uuid().optional() }));
const transferStatus = body(z.enum(TRANSFER_STATUSES).optional());
const alertStatus = body(z.enum(["OPEN", "RESOLVED"]).optional());

@Controller({ path: "admin/claims", version: "1" })
export class AdminClaimsController {
  constructor(
    private readonly claims: ClaimsService,
    private readonly decisions: ClaimDecisionsService,
  ) {}

  @RequirePermission("claims.read")
  @Get()
  list(@CurrentPrincipal() principal: AuthPrincipal, @Query(claimFilters) filters: ClaimFilters) {
    return this.claims.listForStaff(principal, filters);
  }

  @RequirePermission("claims.assess")
  @Post()
  open(@Body(body(reportClaimSchema)) input: ReportClaimInput, @CurrentPrincipal() principal: AuthPrincipal, @Meta() meta: RequestMeta) {
    return this.claims.staffOpen(principal, input, meta);
  }

  @RequirePermission("claims.read")
  @Get(":id")
  detail(@Param("id", uuid) id: string, @CurrentPrincipal() principal: AuthPrincipal) {
    return this.claims.staffDetail(principal, id);
  }

  @RequirePermission("claims.assess")
  @Post(":id/assessment")
  @HttpCode(HttpStatus.OK)
  assess(@Param("id", uuid) id: string, @Body(body(assessClaimSchema)) input: AssessClaimInput, @CurrentPrincipal() principal: AuthPrincipal, @Meta() meta: RequestMeta) {
    return this.decisions.assess(principal, id, input, meta);
  }

  @RequirePermission("claims.decide")
  @Post(":id/decision")
  @HttpCode(HttpStatus.OK)
  decide(@Param("id", uuid) id: string, @Body(body(decideClaimSchema)) input: DecideClaimInput, @CurrentPrincipal() principal: AuthPrincipal, @Meta() meta: RequestMeta) {
    return this.decisions.decide(principal, id, input, meta);
  }
}

@Controller({ path: "admin/custody-alerts", version: "1" })
export class AdminCustodyAlertsController {
  constructor(private readonly alerts: CustodyAlertsService) {}

  @RequirePermission("claims.read")
  @Get()
  list(@CurrentPrincipal() principal: AuthPrincipal, @Query("status", alertStatus) status?: "OPEN" | "RESOLVED") {
    return this.alerts.list(principal, status);
  }

  @RequirePermission("claims.assess")
  @Post(":id/resolve")
  @HttpCode(HttpStatus.OK)
  resolve(@Param("id", uuid) id: string, @Body(body(resolveAlertSchema)) input: { note: string }, @CurrentPrincipal() principal: AuthPrincipal, @Meta() meta: RequestMeta) {
    return this.alerts.resolve(principal, id, input.note, meta);
  }
}

@Controller({ path: "admin/transfers", version: "1" })
export class AdminTransfersController {
  constructor(private readonly transfers: TransfersService) {}

  @RequirePermission("transfers.manage")
  @Get()
  list(@CurrentPrincipal() principal: AuthPrincipal, @Query("status", transferStatus) status?: (typeof TRANSFER_STATUSES)[number]) {
    return this.transfers.listForAdmin(principal, status);
  }

  @RequirePermission("transfers.manage")
  @Post()
  create(@Body(body(createTransferSchema)) input: CreateTransferInput, @CurrentPrincipal() principal: AuthPrincipal, @Meta() meta: RequestMeta) {
    return this.transfers.create(principal, input, meta);
  }

  @RequirePermission("transfers.manage")
  @Get(":id")
  detail(@Param("id", uuid) id: string, @CurrentPrincipal() principal: AuthPrincipal) {
    return this.transfers.adminDetail(principal, id);
  }

  @RequirePermission("transfers.manage")
  @Post(":id/cancel")
  @HttpCode(HttpStatus.OK)
  cancel(@Param("id", uuid) id: string, @CurrentPrincipal() principal: AuthPrincipal, @Meta() meta: RequestMeta) {
    return this.transfers.cancel(principal, id, meta);
  }
}

@Controller({ path: "admin/partners", version: "1" })
export class AdminPartnerTrustController {
  constructor(
    private readonly partners: AdminPartnersService,
    private readonly trust: TrustService,
  ) {}

  @RequirePermission("partners.read")
  @Get(":id/trust")
  async trustScore(@Param("id", uuid) id: string, @CurrentPrincipal() principal: AuthPrincipal) {
    await this.partners.scoped(principal, id);
    return this.trust.evaluate(id);
  }
}

@Controller({ path: "partner", version: "1" })
export class PartnerCustodyController {
  constructor(
    private readonly claims: ClaimsService,
    private readonly decisions: ClaimDecisionsService,
    private readonly trust: TrustService,
  ) {}

  @RequirePermission("partner.profile.read")
  @Get("trust")
  trustScore(@CurrentPrincipal() principal: AuthPrincipal) {
    return this.trust.evaluate(partnerIdOf(principal));
  }

  @RequirePermission("partner.statement.read")
  @Get("claims")
  list(@CurrentPrincipal() principal: AuthPrincipal) {
    return this.claims.listForPartner(principal);
  }

  @RequirePermission("partner.statement.read")
  @Get("claims/:id")
  detail(@Param("id", uuid) id: string, @CurrentPrincipal() principal: AuthPrincipal) {
    return this.claims.partnerDetail(principal, id);
  }

  @RequirePermission("partner.statement.read")
  @Post("claims/:id/response")
  @HttpCode(HttpStatus.OK)
  respond(@Param("id", uuid) id: string, @Body(body(claimResponseSchema)) input: { response: string }, @CurrentPrincipal() principal: AuthPrincipal, @Meta() meta: RequestMeta) {
    return this.decisions.respond(principal, id, input.response, meta);
  }
}

@Injectable()
abstract class HubTransfersBase {
  constructor(
    protected readonly transfers: TransfersService,
    protected readonly movements: TransferMovementsService,
  ) {}

  protected listFor(principal: AuthPrincipal) {
    return this.transfers.listForHub(principal);
  }

  protected detailFor(principal: AuthPrincipal, id: string) {
    return this.transfers.hubDetail(principal, id);
  }

  protected dispatchFor(principal: AuthPrincipal, id: string, input: DispatchTransferInput, meta: RequestMeta) {
    return this.movements.dispatch(principal, id, input, meta);
  }

  protected receiveFor(principal: AuthPrincipal, id: string, input: ReceiveTransferInput, meta: RequestMeta) {
    return this.movements.receive(principal, id, input, meta);
  }
}

@Controller({ path: "partner/transfers", version: "1" })
export class PartnerTransfersController extends HubTransfersBase {
  @RequirePermission("partner.profile.read")
  @Get()
  list(@CurrentPrincipal() principal: AuthPrincipal) {
    return this.listFor(principal);
  }

  @RequirePermission("partner.profile.read")
  @Get(":id")
  detail(@Param("id", uuid) id: string, @CurrentPrincipal() principal: AuthPrincipal) {
    return this.detailFor(principal, id);
  }

  @RequirePermission("partner.profile.read")
  @Post(":id/dispatch")
  @HttpCode(HttpStatus.OK)
  dispatch(@Param("id", uuid) id: string, @Body(body(dispatchTransferSchema)) input: DispatchTransferInput, @CurrentPrincipal() principal: AuthPrincipal, @Meta() meta: RequestMeta) {
    return this.dispatchFor(principal, id, input, meta);
  }

  @RequirePermission("partner.profile.read")
  @Post(":id/receive")
  @HttpCode(HttpStatus.OK)
  receive(@Param("id", uuid) id: string, @Body(body(receiveTransferSchema)) input: ReceiveTransferInput, @CurrentPrincipal() principal: AuthPrincipal, @Meta() meta: RequestMeta) {
    return this.receiveFor(principal, id, input, meta);
  }
}

@Controller({ path: "warehouse/transfers", version: "1" })
export class WarehouseTransfersController extends HubTransfersBase {
  @RequirePermission("inbound.receive")
  @Get()
  list(@CurrentPrincipal() principal: AuthPrincipal) {
    return this.listFor(principal);
  }

  @RequirePermission("inbound.receive")
  @Get(":id")
  detail(@Param("id", uuid) id: string, @CurrentPrincipal() principal: AuthPrincipal) {
    return this.detailFor(principal, id);
  }

  @RequirePermission("inbound.receive")
  @Post(":id/dispatch")
  @HttpCode(HttpStatus.OK)
  dispatch(@Param("id", uuid) id: string, @Body(body(dispatchTransferSchema)) input: DispatchTransferInput, @CurrentPrincipal() principal: AuthPrincipal, @Meta() meta: RequestMeta) {
    return this.dispatchFor(principal, id, input, meta);
  }

  @RequirePermission("inbound.receive")
  @Post(":id/receive")
  @HttpCode(HttpStatus.OK)
  receive(@Param("id", uuid) id: string, @Body(body(receiveTransferSchema)) input: ReceiveTransferInput, @CurrentPrincipal() principal: AuthPrincipal, @Meta() meta: RequestMeta) {
    return this.receiveFor(principal, id, input, meta);
  }
}

@Controller({ path: "vendor", version: "1" })
export class VendorCustodyController {
  constructor(
    private readonly claims: ClaimsService,
    private readonly hubs: HubSignalsService,
  ) {}

  @RequirePermission("vendor.stock.read")
  @Get("hubs")
  hubSignals(@SelectedCountry() country: SellerCountry) {
    return this.hubs.forVendor(country);
  }

  @RequirePermission("vendor.orders.read")
  @Get("claims")
  list(@SelectedCountry() country: SellerCountry) {
    return this.claims.listForVendor(country);
  }

  @RequirePermission("vendor.orders.read")
  @Get("claims/:id")
  detail(@Param("id", uuid) id: string, @CurrentPrincipal() principal: AuthPrincipal) {
    return this.claims.vendorDetail(principal, id);
  }

  @RequirePermission("vendor.orders.manage")
  @Throttle(THROTTLE.uploads)
  @Post("claims")
  report(@Body(body(reportClaimSchema)) input: ReportClaimInput, @CurrentPrincipal() principal: AuthPrincipal, @Meta() meta: RequestMeta) {
    return this.claims.report(principal, input, meta);
  }
}
