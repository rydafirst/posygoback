import { Injectable } from "@nestjs/common";

import type { AuthPrincipal, RequestMeta } from "../../../common/auth/auth-principal";
import { Errors } from "../../../common/http/app-exception";
import { lockRow, PrismaService } from "../../../database/prisma.service";
import { type FulfilmentPartner, Prisma } from "../../../generated/prisma/client";
import { AuditService } from "../../../infrastructure/audit/audit.service";
import type { PartnerDetailView, PartnerProfileInput, PartnerStatus, ProfileChangeDecisionInput } from "../../../shared";
import { StaffAlertsService } from "../../notifications/staff-alerts.service";
import { actorOf, AdminPartnersService } from "../admin/admin-partners.service";
import { hubName } from "../hub-name";
import { PartnerEmails } from "../partner-emails";
import { PartnerNotifierService } from "../partner-notifier.service";
import type { StoredProfile } from "../partners.repository";
import { PartnerAccessService } from "./partner-access.service";

const CHANGEABLE: readonly PartnerStatus[] = ["ACTIVE", "SUSPENDED"];
const ACCOUNT_PAGE = "/admin/partnership/account";

function addressChanged(current: StoredProfile | null, proposed: PartnerProfileInput): boolean {
  return (["addressLines", "city", "postalCode"] as const).some((field) => JSON.stringify(current?.[field]) !== JSON.stringify(proposed[field]));
}

function sameProfile(current: StoredProfile | null, proposed: PartnerProfileInput): boolean {
  return (Object.keys(proposed) as Array<keyof PartnerProfileInput>).every((field) => JSON.stringify(current?.[field]) === JSON.stringify(proposed[field]));
}

@Injectable()
export class PartnerProfileChangesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: PartnerAccessService,
    private readonly admin: AdminPartnersService,
    private readonly notifier: PartnerNotifierService,
    private readonly staffAlerts: StaffAlertsService,
    private readonly audit: AuditService,
  ) {}

  async request(principal: AuthPrincipal, input: PartnerProfileInput, meta: RequestMeta): Promise<void> {
    const partner = await this.access.mutate(principal, CHANGEABLE, "You can ask to change your details once your hub is approved.", async (tx, current) => {
      if (sameProfile(current.profile as StoredProfile | null, input)) {
        throw Errors.validation({ profile: ["Change at least one detail first"] });
      }
      await tx.fulfilmentPartner.update({ where: { id: current.id }, data: { profileChange: input, profileChangeAt: new Date() } });
      await this.record(tx, { userId: principal.userId, role: principal.role }, current, "partner.profile_change_requested", { proposed: input }, meta);
      return current;
    });
    await this.staffAlerts.raise("partners", {
      countryCode: partner.countryCode,
      title: `${partner.legalName} asked to change their details`,
      body: "Check the new details, and ask for a new proof of address if the address changed, before you approve.",
      href: `/admin/partners/${partner.id}`,
    });
  }

  async withdraw(principal: AuthPrincipal, meta: RequestMeta): Promise<void> {
    await this.access.mutate(principal, CHANGEABLE, "Your hub isn't open for changes.", async (tx, partner) => {
      if (!partner.profileChange) {
        throw Errors.invalidTransition("There's no change waiting for review.");
      }
      await tx.fulfilmentPartner.update({ where: { id: partner.id }, data: { profileChange: Prisma.DbNull, profileChangeAt: null } });
      await this.record(tx, { userId: principal.userId, role: principal.role }, partner, "partner.profile_change_withdrawn", {}, meta);
    });
  }

  async decide(principal: AuthPrincipal, partnerId: string, input: ProfileChangeDecisionInput, meta: RequestMeta): Promise<PartnerDetailView> {
    await this.admin.scoped(principal, partnerId);
    await this.prisma.$transaction(async (tx) => {
      await lockRow(tx, "fulfilmentPartners", partnerId);
      const partner = await tx.fulfilmentPartner.findUniqueOrThrow({ where: { id: partnerId } });
      const proposed = partner.profileChange as PartnerProfileInput | null;
      if (!proposed) {
        throw Errors.invalidTransition("There's no change waiting for review.");
      }
      const previous = partner.profile as StoredProfile | null;
      await tx.fulfilmentPartner.update({
        where: { id: partnerId },
        data: { profileChange: Prisma.DbNull, profileChangeAt: null, ...(input.approve ? { profile: { ...proposed, heardFrom: previous?.heardFrom }, legalName: proposed.fullName } : {}) },
      });
      if (input.approve && addressChanged(previous, proposed)) {
        await tx.warehouse.updateMany({
          where: { partnerId },
          data: { name: hubName(proposed.city), addressLines: proposed.addressLines, city: proposed.city, postalCode: proposed.postalCode },
        });
      }
      await this.record(tx, actorOf(principal), partner, input.approve ? "partner.profile_change_approved" : "partner.profile_change_declined", { before: previous, proposed, note: input.note }, meta);
    });
    await this.notifier.notify(partnerId, (to, webUrl) => PartnerEmails.profileChangeDecided(to, input.approve, input.note, webUrl), ACCOUNT_PAGE);
    return this.admin.detail(principal, partnerId);
  }

  private record(tx: Prisma.TransactionClient, actor: { userId: string; role: AuthPrincipal["role"] }, partner: FulfilmentPartner, action: string, after: object, meta: RequestMeta) {
    return this.audit.record({ actor, action, resourceType: "fulfilment_partner", resourceId: partner.id, countryCode: partner.countryCode, after, meta }, tx);
  }
}
