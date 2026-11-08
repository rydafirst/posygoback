import { Body, Controller, HttpCode, HttpStatus, Param, ParseUUIDPipe, Post } from "@nestjs/common";

import type { AuthPrincipal, RequestMeta } from "../../common/auth/auth-principal";
import { CurrentPrincipal, Meta, RequirePermission } from "../../common/auth/decorators";
import { ZodValidationPipe } from "../../common/http/zod-validation.pipe";
import { type AccountActionInput, accountActionSchema } from "../../shared";
import { AccountAccessService } from "./account-access.service";
import { AccountRemovalService } from "./account-removal.service";

const uuid = new ParseUUIDPipe({ version: "4" });
const reasonBody = new ZodValidationPipe(accountActionSchema);

@Controller({ path: "admin/vendors", version: "1" })
export class AdminVendorAccountsController {
  constructor(
    private readonly access: AccountAccessService,
    private readonly removal: AccountRemovalService,
  ) {}

  @RequirePermission("accounts.close")
  @Post(":id/deactivate")
  @HttpCode(HttpStatus.NO_CONTENT)
  deactivate(@Param("id", uuid) id: string, @Body(reasonBody) input: AccountActionInput, @CurrentPrincipal() principal: AuthPrincipal, @Meta() meta: RequestMeta) {
    return this.access.deactivateVendor(principal, id, input.reason, meta);
  }

  @RequirePermission("accounts.close")
  @Post(":id/reactivate")
  @HttpCode(HttpStatus.NO_CONTENT)
  reactivate(@Param("id", uuid) id: string, @Body(reasonBody) input: AccountActionInput, @CurrentPrincipal() principal: AuthPrincipal, @Meta() meta: RequestMeta) {
    return this.access.reactivateVendor(principal, id, input.reason, meta);
  }

  @RequirePermission("accounts.close")
  @Post(":id/delete")
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(@Param("id", uuid) id: string, @Body(reasonBody) input: AccountActionInput, @CurrentPrincipal() principal: AuthPrincipal, @Meta() meta: RequestMeta) {
    return this.removal.deleteVendor(principal, id, input.reason, meta);
  }
}

@Controller({ path: "admin/partners", version: "1" })
export class AdminPartnerAccountsController {
  constructor(
    private readonly access: AccountAccessService,
    private readonly removal: AccountRemovalService,
  ) {}

  @RequirePermission("accounts.close")
  @Post(":id/deactivate")
  @HttpCode(HttpStatus.NO_CONTENT)
  deactivate(@Param("id", uuid) id: string, @Body(reasonBody) input: AccountActionInput, @CurrentPrincipal() principal: AuthPrincipal, @Meta() meta: RequestMeta) {
    return this.access.deactivatePartner(principal, id, input.reason, meta);
  }

  @RequirePermission("accounts.close")
  @Post(":id/reactivate")
  @HttpCode(HttpStatus.NO_CONTENT)
  reactivate(@Param("id", uuid) id: string, @Body(reasonBody) input: AccountActionInput, @CurrentPrincipal() principal: AuthPrincipal, @Meta() meta: RequestMeta) {
    return this.access.reactivatePartner(principal, id, input.reason, meta);
  }

  @RequirePermission("accounts.close")
  @Post(":id/delete")
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(@Param("id", uuid) id: string, @Body(reasonBody) input: AccountActionInput, @CurrentPrincipal() principal: AuthPrincipal, @Meta() meta: RequestMeta) {
    return this.removal.deletePartner(principal, id, input.reason, meta);
  }
}
