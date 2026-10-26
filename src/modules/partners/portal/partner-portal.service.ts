import { Injectable } from "@nestjs/common";

import type { AuthPrincipal, RequestMeta } from "../../../common/auth/auth-principal";
import { Errors } from "../../../common/http/app-exception";
import { AuditService } from "../../../infrastructure/audit/audit.service";
import { CLOSED_PARTNER_STATUSES, type InsurancePolicyInput, type PartnerDetailView } from "../../../shared";
import { FilesService } from "../../files/files.service";
import { StaffService } from "../../staff/staff.service";
import { actorOf } from "../admin/admin-partners.service";
import { PartnerReadinessService } from "../partner-readiness.service";
import { PartnersRepository } from "../partners.repository";
import { OPEN_PARTNER_STATUSES, PartnerAccessService, partnerIdOf } from "./partner-access.service";

@Injectable()
export class PartnerPortalService {
  constructor(
    private readonly access: PartnerAccessService,
    private readonly partners: PartnersRepository,
    private readonly readiness: PartnerReadinessService,
    private readonly files: FilesService,
    private readonly staff: StaffService,
    private readonly audit: AuditService,
  ) {}

  async overview(principal: AuthPrincipal): Promise<PartnerDetailView> {
    const partnerId = partnerIdOf(principal);
    const view = await this.partners.view(await this.partners.detail(partnerId), await this.readiness.evaluate(partnerId));
    const shared = { ...view, decisions: [], securities: view.securities.map((security) => ({ ...security, reference: "" })) };
    if (principal.role === "FULFILMENT_PARTNER") {
      return shared;
    }
    return {
      ...shared,
      contactEmail: "",
      profile: null,
      heardFrom: null,
      checks: shared.checks.map((check) => ({ ...check, details: {}, fileIds: [], reviewNote: null, callOutcome: null })),
      agreements: [],
      insurance: [],
      securities: [],
      payoutAccount: null,
      team: [],
      pendingInvitations: [],
    };
  }

  async addInsurance(principal: AuthPrincipal, input: InsurancePolicyInput, meta: RequestMeta): Promise<void> {
    const statuses = await this.files.uploadedBy(principal.userId, [input.fileId], "PARTNER_EVIDENCE");
    if (statuses.get(input.fileId) !== "VERIFIED") {
      throw Errors.validation({ fileId: ["Upload the policy document and wait for it to be checked"] });
    }
    await this.access.mutate(principal, OPEN_PARTNER_STATUSES, "This partnership is closed.", async (tx, partner) => {
      if ((await tx.partnerInsurancePolicy.count({ where: { partnerId: partner.id, status: "PENDING" } })) >= 3) {
        throw Errors.invalidTransition("Wait for your pending policies to be reviewed before adding another.");
      }
      const currency = (await tx.country.findUniqueOrThrow({ where: { code: partner.countryCode }, select: { currency: true } })).currency;
      const policy = await tx.partnerInsurancePolicy.create({
        data: {
          partnerId: partner.id,
          insurer: input.insurer,
          policyNumber: input.policyNumber,
          coverMinor: BigInt(input.coverMinor),
          currency,
          startsOn: new Date(`${input.startsOn}T00:00:00Z`),
          expiresOn: new Date(`${input.expiresOn}T00:00:00Z`),
          fileId: input.fileId,
          uploadedBy: principal.userId,
        },
      });
      await this.audit.record(
        {
          actor: actorOf(principal),
          action: "partner.insurance_uploaded",
          resourceType: "partner_insurance_policy",
          resourceId: policy.id,
          countryCode: partner.countryCode,
          after: { insurer: input.insurer, expiresOn: input.expiresOn },
          meta,
        },
        tx,
      );
    });
  }

  async inviteTeamMember(principal: AuthPrincipal, email: string, meta: RequestMeta): Promise<void> {
    const partner = await this.access.current(principal);
    if (CLOSED_PARTNER_STATUSES.includes(partner.status)) {
      throw Errors.invalidTransition("This partnership is closed.");
    }
    await this.staff.issueInvitation(principal, { email, role: "PARTNER_STAFF", countryCode: partner.countryCode, partnerId: partner.id }, meta);
  }

  revokeInvitation(principal: AuthPrincipal, invitationId: string, meta: RequestMeta): Promise<void> {
    return this.staff.revoke(principal, invitationId, meta, partnerIdOf(principal));
  }

  suspendTeamMember(principal: AuthPrincipal, userId: string, meta: RequestMeta): Promise<void> {
    return this.staff.suspend(principal, userId, meta, partnerIdOf(principal));
  }
}
