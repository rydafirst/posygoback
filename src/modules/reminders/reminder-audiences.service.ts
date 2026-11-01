import { Injectable } from "@nestjs/common";

import { PrismaService } from "../../database/prisma.service";
import type { ReminderKey } from "../../shared";

export interface ReminderCandidate {
  subjectId: string;
  email: string;
  name: string;
  since: Date;
}

const QUIET_DAYS = 30;
const DAY_MS = 24 * 60 * 60 * 1000;
const UNFINISHED_CHECKS = ["NOT_STARTED", "IN_PROGRESS", "RESUBMISSION_REQUIRED"] as const;

interface OwnedVendor {
  id: string;
  businessName: string;
  updatedAt: Date;
  users: Array<{ email: string; createdAt: Date; emailVerifiedAt: Date | null }>;
}

const OWNER = { users: { where: { role: "VENDOR_OWNER" as const }, select: { email: true, createdAt: true, emailVerifiedAt: true }, take: 1 } };

function latest(...dates: ReadonlyArray<Date | null | undefined>): Date | null {
  const present = dates.filter((date): date is Date => date instanceof Date);
  return present.length ? new Date(Math.max(...present.map((date) => date.getTime()))) : null;
}

function firstName(legalName: string): string {
  return legalName.trim().split(/\s+/)[0] ?? legalName;
}

@Injectable()
export class ReminderAudiencesService {
  constructor(private readonly prisma: PrismaService) {}

  find(key: ReminderKey, now: Date): Promise<ReminderCandidate[]> {
    switch (key) {
      case "SELLER_CONFIRM_EMAIL":
        return this.unconfirmedSellers();
      case "SELLER_VERIFY_BUSINESS":
        return this.unverifiedSellers();
      case "SELLER_ACTIVATION_FEE":
        return this.unpaidSellers();
      case "SELLER_FIRST_PRODUCT":
        return this.sellersWithoutProducts();
      case "SELLER_FIRST_SHIPMENT":
        return this.sellersWithoutShipments();
      case "SELLER_QUIET":
        return this.quietSellers(now);
      case "PARTNER_SEND_FOR_REVIEW":
        return this.unsubmittedPartners();
      case "PARTNER_PAYOUTS":
        return this.partnersWithoutPayouts();
    }
  }

  private toCandidates<Vendor extends OwnedVendor>(vendors: readonly Vendor[], since: (vendor: Vendor) => Date | null): ReminderCandidate[] {
    return vendors.flatMap((vendor) => {
      const owner = vendor.users[0];
      const from = since(vendor);
      return owner && from ? [{ subjectId: vendor.id, email: owner.email, name: vendor.businessName, since: from }] : [];
    });
  }

  private async unconfirmedSellers(): Promise<ReminderCandidate[]> {
    const vendors = await this.prisma.vendor.findMany({
      where: { isTestAccount: false, users: { some: { role: "VENDOR_OWNER", status: "PENDING_EMAIL_VERIFICATION" } } },
      select: { id: true, businessName: true, updatedAt: true, ...OWNER },
    });
    return this.toCandidates(vendors, (vendor) => vendor.users[0]?.createdAt ?? null);
  }

  private async unverifiedSellers(): Promise<ReminderCandidate[]> {
    const vendors = await this.prisma.vendor.findMany({
      where: {
        isTestAccount: false,
        status: "PENDING_VERIFICATION",
        activationDueAt: null,
        users: { some: { role: "VENDOR_OWNER", status: "ACTIVE" } },
        OR: [{ verification: null }, { verification: { status: { in: [...UNFINISHED_CHECKS] } } }],
      },
      select: { id: true, businessName: true, updatedAt: true, verification: { select: { updatedAt: true } }, ...OWNER },
    });
    return this.toCandidates(vendors, (vendor) => latest(vendor.users[0]?.emailVerifiedAt, vendor.verification?.updatedAt));
  }

  private async unpaidSellers(): Promise<ReminderCandidate[]> {
    const vendors = await this.prisma.vendor.findMany({
      where: { isTestAccount: false, status: "PENDING_VERIFICATION", activationDueAt: { not: null } },
      select: { id: true, businessName: true, updatedAt: true, activationDueAt: true, ...OWNER },
    });
    return this.toCandidates(vendors, (vendor) => vendor.activationDueAt);
  }

  private async sellersWithoutProducts(): Promise<ReminderCandidate[]> {
    const vendors = await this.prisma.vendor.findMany({
      where: { isTestAccount: false, status: "ACTIVE", products: { none: {} } },
      select: { id: true, businessName: true, updatedAt: true, verification: { select: { decidedAt: true } }, ...OWNER },
    });
    return this.toCandidates(vendors, (vendor) => vendor.verification?.decidedAt ?? vendor.updatedAt);
  }

  private async sellersWithoutShipments(): Promise<ReminderCandidate[]> {
    const vendors = await this.prisma.vendor.findMany({
      where: { isTestAccount: false, status: "ACTIVE", products: { some: {} }, inboundShipments: { none: { submittedAt: { not: null } } } },
      select: { id: true, businessName: true, updatedAt: true, products: { select: { createdAt: true }, orderBy: { createdAt: "asc" }, take: 1 }, ...OWNER },
    });
    return this.toCandidates(vendors, (vendor) => vendor.products[0]?.createdAt ?? null);
  }

  private async quietSellers(now: Date): Promise<ReminderCandidate[]> {
    const vendors = await this.prisma.vendor.findMany({
      where: { isTestAccount: false, status: "ACTIVE", inboundShipments: { some: { receivedAt: { not: null } } } },
      select: {
        id: true,
        businessName: true,
        updatedAt: true,
        orders: { select: { createdAt: true }, orderBy: { createdAt: "desc" }, take: 1 },
        inboundShipments: { where: { receivedAt: { not: null } }, select: { receivedAt: true }, orderBy: { receivedAt: "desc" }, take: 1 },
        ...OWNER,
      },
    });
    const cutoff = now.getTime() - QUIET_DAYS * DAY_MS;
    return this.toCandidates(vendors, (vendor) => {
      const lastActive = latest(vendor.orders[0]?.createdAt, vendor.inboundShipments[0]?.receivedAt);
      return lastActive && lastActive.getTime() <= cutoff ? lastActive : null;
    });
  }

  private async unsubmittedPartners(): Promise<ReminderCandidate[]> {
    const partners = await this.prisma.fulfilmentPartner.findMany({ where: { status: "VERIFYING" }, select: { id: true, legalName: true, contactEmail: true, createdAt: true } });
    return partners.map((partner) => ({ subjectId: partner.id, email: partner.contactEmail, name: firstName(partner.legalName), since: partner.createdAt }));
  }

  private async partnersWithoutPayouts(): Promise<ReminderCandidate[]> {
    const partners = await this.prisma.fulfilmentPartner.findMany({
      where: { status: "ACTIVE", activatedAt: { not: null }, OR: [{ payoutAccount: null }, { payoutAccount: { status: { not: "ACTIVE" } } }] },
      select: { id: true, legalName: true, contactEmail: true, activatedAt: true },
    });
    return partners.map((partner) => ({ subjectId: partner.id, email: partner.contactEmail, name: firstName(partner.legalName), since: partner.activatedAt! }));
  }
}
