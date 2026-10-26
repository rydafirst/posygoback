import { Injectable } from "@nestjs/common";

import { type DatabaseClient, PrismaService } from "../../database/prisma.service";
import type { PartnerStatus, Prisma, User, VendorStatus } from "../../generated/prisma/client";

export type UserRecord = User;
export type UserUpdate = Omit<Prisma.UserUncheckedUpdateInput, "id" | "email" | "createdAt">;

export interface UserProfile {
  user: UserRecord;
  businessName: string | null;
  vendorStatus: VendorStatus | null;
  vendorCountryCode: string | null;
  currency: string | null;
  partnerStatus: PartnerStatus | null;
}

@Injectable()
export class UsersRepository {
  constructor(private readonly prisma: PrismaService) {}

  async findByEmail(email: string): Promise<UserRecord | undefined> {
    return (await this.prisma.user.findUnique({ where: { email } })) ?? undefined;
  }

  async findById(id: string, client: DatabaseClient = this.prisma): Promise<UserRecord | undefined> {
    return (await client.user.findUnique({ where: { id } })) ?? undefined;
  }

  async findVendorOwner(vendorId: string): Promise<UserRecord | undefined> {
    return (await this.prisma.user.findFirst({ where: { vendorId, role: "VENDOR_OWNER" } })) ?? undefined;
  }

  async findProfile(id: string): Promise<UserProfile | undefined> {
    const found = await this.prisma.user.findUnique({
      where: { id },
      include: { vendor: { include: { country: true } }, partner: { select: { status: true, country: { select: { currency: true } } } } },
    });
    if (!found) {
      return undefined;
    }
    const { vendor, partner, ...user } = found;
    return {
      user,
      businessName: vendor?.businessName ?? null,
      vendorStatus: vendor?.status ?? null,
      vendorCountryCode: vendor?.countryCode ?? null,
      currency: vendor?.country.currency ?? partner?.country.currency ?? null,
      partnerStatus: partner?.status ?? null,
    };
  }

  async createVendorOwner(input: { email: string; passwordHash: string; businessName: string; countryCode: string; referralCode?: string }, client: DatabaseClient): Promise<UserRecord> {
    const vendor = await client.vendor.create({ data: { businessName: input.businessName, countryCode: input.countryCode, signupReferralCode: input.referralCode?.slice(0, 40) || null } });
    return client.user.create({ data: { email: input.email, passwordHash: input.passwordHash, role: "VENDOR_OWNER", vendorId: vendor.id, countryCode: input.countryCode } });
  }

  async replacePendingSignup(user: UserRecord, input: { passwordHash: string; businessName: string; countryCode: string }, client: DatabaseClient): Promise<void> {
    await client.user.updateMany({
      where: { id: user.id, status: "PENDING_EMAIL_VERIFICATION" },
      data: { passwordHash: input.passwordHash, countryCode: input.countryCode, failedLoginCount: 0, lockedUntil: null },
    });
    if (user.vendorId) {
      await client.vendor.update({ where: { id: user.vendorId }, data: { businessName: input.businessName, countryCode: input.countryCode } });
    }
  }

  async incrementFailures(id: string): Promise<number> {
    const updated = await this.prisma.user.update({ where: { id }, data: { failedLoginCount: { increment: 1 } }, select: { failedLoginCount: true } });
    return updated.failedLoginCount;
  }

  async resetFailures(id: string): Promise<void> {
    await this.prisma.user.updateMany({ where: { id, OR: [{ failedLoginCount: { gt: 0 } }, { lockedUntil: { not: null } }] }, data: { failedLoginCount: 0, lockedUntil: null } });
  }

  async update(id: string, changes: UserUpdate, client: DatabaseClient = this.prisma): Promise<void> {
    await client.user.update({ where: { id }, data: changes });
  }
}
