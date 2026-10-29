import { Injectable } from "@nestjs/common";

import type { AuthPrincipal } from "../../common/auth/auth-principal";
import { PartnerContextService } from "./context/partner-context.service";
import { StaffContextService } from "./context/staff-context.service";
import { VendorContextService } from "./context/vendor-context.service";

@Injectable()
export class AccountSummaryService {
  constructor(
    private readonly vendors: VendorContextService,
    private readonly partners: PartnerContextService,
    private readonly staff: StaffContextService,
  ) {}

  describe(principal: AuthPrincipal | null): Promise<string> {
    if (!principal) {
      return Promise.resolve("Who you're helping: a visitor who isn't signed in.");
    }
    if (principal.vendorId) {
      return this.vendors.describe({ ...principal, vendorId: principal.vendorId });
    }
    if (principal.partnerId) {
      return this.partners.describe({ ...principal, partnerId: principal.partnerId });
    }
    return this.staff.describe(principal);
  }
}
