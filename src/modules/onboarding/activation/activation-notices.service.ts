import { Injectable } from "@nestjs/common";

import { PrismaService } from "../../../database/prisma.service";
import { activationFeeOf, Money } from "../../../shared";
import { WalletAlertsService } from "../../finance/wallets/wallet-alerts.service";
import { StaffAlertsService } from "../../notifications/staff-alerts.service";
import { OnboardingEmails } from "../onboarding-emails";

export interface PaidActivation {
  paymentId: string;
  vendorId: string;
  countryCode: string;
  feeMinor: number;
  currency: string;
  paidAt: Date;
}

const LOCALE = "en-GB";
const PAID_ON = new Intl.DateTimeFormat(LOCALE, { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });

@Injectable()
export class ActivationNoticesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly owners: WalletAlertsService,
    private readonly staff: StaffAlertsService,
  ) {}

  async due(vendorId: string): Promise<void> {
    const vendor = await this.prisma.vendor.findUniqueOrThrow({ where: { id: vendorId }, include: { country: true } });
    const fee = Money.of(activationFeeOf(vendor.country.config as { activationFeeMinor?: unknown }), vendor.country.currency).format(LOCALE);
    await this.owners.notifyOwner(vendorId, (to, webUrl) => OnboardingEmails.activationDue(to, fee, webUrl), "/verification");
  }

  async waived(vendorId: string): Promise<void> {
    await this.owners.notifyOwner(vendorId, (to, webUrl) => OnboardingEmails.accountLive(to, null, webUrl), "/overview");
  }

  async paid(activation: PaidActivation): Promise<void> {
    const amount = Money.of(activation.feeMinor, activation.currency).format(LOCALE);
    const receipt = { amount, paidOn: PAID_ON.format(activation.paidAt), reference: activation.paymentId };
    await this.owners.notifyOwner(activation.vendorId, (to, webUrl) => OnboardingEmails.accountLive(to, receipt, webUrl), "/overview");
    const vendor = await this.prisma.vendor.findUniqueOrThrow({ where: { id: activation.vendorId }, select: { businessName: true } });
    await this.staff.raise("vendorActivated", { countryCode: activation.countryCode, title: `${vendor.businessName} is live`, body: `They paid the ${amount} activation fee.` });
  }
}
