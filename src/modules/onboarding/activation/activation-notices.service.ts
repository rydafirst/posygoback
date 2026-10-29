import { Injectable } from "@nestjs/common";

import { PrismaService } from "../../../database/prisma.service";
import { activationFeeOf, Money, sellerNumber } from "../../../shared";
import { WalletAlertsService } from "../../finance/wallets/wallet-alerts.service";
import { StaffAlertsService } from "../../notifications/staff-alerts.service";
import { type ActivationReceipt, OnboardingEmails } from "../onboarding-emails";

export interface PaidActivation {
  paymentId: string;
  vendorId: string;
  countryCode: string;
  feeMinor: number;
  currency: string;
  paidAt: Date;
}

const LOCALE = "en-GB";

function paymentReference(paymentId: string): string {
  return `PSG-PAY-${paymentId.replace(/-/g, "").slice(0, 10).toUpperCase()}`;
}
const LONG_DATE = new Intl.DateTimeFormat(LOCALE, { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });

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
    await this.welcome(vendorId, new Date(), null);
  }

  async paid(activation: PaidActivation): Promise<void> {
    const amount = Money.of(activation.feeMinor, activation.currency).format(LOCALE);
    const businessName = await this.welcome(activation.vendorId, activation.paidAt, { amount, reference: paymentReference(activation.paymentId) });
    await this.staff.raise("vendorActivated", { countryCode: activation.countryCode, title: `${businessName} is live`, body: `They paid the ${amount} activation fee.` });
  }

  private async welcome(vendorId: string, activeFrom: Date, receipt: ActivationReceipt | null): Promise<string> {
    const vendor = await this.prisma.vendor.findUniqueOrThrow({ where: { id: vendorId }, include: { country: { select: { name: true } } } });
    const welcome = { businessName: vendor.businessName, sellerNumber: sellerNumber(vendor.id), country: vendor.country.name, activeFrom: LONG_DATE.format(activeFrom), receipt };
    await this.owners.notifyOwner(vendorId, (to, webUrl) => OnboardingEmails.sellerWelcome(to, welcome, webUrl), "/overview");
    return vendor.businessName;
  }
}
