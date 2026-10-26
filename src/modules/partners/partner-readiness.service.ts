import { Injectable } from "@nestjs/common";

import { startOfUtcDay } from "../../common/dates";
import { type DatabaseClient, PrismaService } from "../../database/prisma.service";
import { type ActivationReadiness, PARTNER_CHECK_KINDS, PARTNER_LEGAL_KINDS } from "../../shared";
import { sameName } from "./partner-names";
import { PartnersRepository } from "./partners.repository";

const NOT_READY: ActivationReadiness = { steps: false, agreement: false, payoutAccount: false, deposit: false, insurance: false };

const LABELS: Record<keyof ActivationReadiness, string> = {
  steps: "every verification step accepted",
  agreement: "the current partner agreement signed",
  payoutAccount: "payouts set up",
  deposit: "the deposit held and confirmed",
  insurance: "verified insurance with enough cover",
};

@Injectable()
export class PartnerReadinessService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly partners: PartnersRepository,
  ) {}

  async evaluate(partnerId: string, client: DatabaseClient = this.prisma): Promise<ActivationReadiness> {
    const partner = await client.fulfilmentPartner.findUnique({ where: { id: partnerId } });
    if (!partner) {
      return NOT_READY;
    }
    const today = startOfUtcDay(new Date());
    const accepted = await client.partnerCheck.count({ where: { partnerId, status: "ACCEPTED" } });
    const documents = await this.partners.latestAgreements(partner.countryCode, client);
    const signatures = await client.partnerAgreementAcceptance.findMany({ where: { partnerId, signatureName: { not: null } }, select: { legalDocumentId: true, signatureName: true } });
    const signedIds = new Set(signatures.filter((signature) => sameName(signature.signatureName, partner.legalName)).map((signature) => signature.legalDocumentId));
    const payout = await client.partnerPayoutAccount.findUnique({ where: { partnerId }, select: { status: true } });
    return {
      steps: accepted === PARTNER_CHECK_KINDS.length,
      agreement: documents.length === PARTNER_LEGAL_KINDS.length && documents.every((document) => signedIds.has(document.id)),
      payoutAccount: payout?.status === "ACTIVE",
      deposit: partner.requiredDepositMinor === 0n || (await this.heldDeposit(client, partnerId, today)) >= partner.requiredDepositMinor,
      insurance:
        partner.requiredInsuranceMinor === 0n ||
        (await client.partnerInsurancePolicy.count({
          where: { partnerId, status: "VERIFIED", startsOn: { lte: today }, expiresOn: { gt: today }, coverMinor: { gte: partner.requiredInsuranceMinor } },
        })) > 0,
    };
  }

  private async heldDeposit(client: DatabaseClient, partnerId: string, today: Date): Promise<bigint> {
    const held = await client.partnerSecurity.aggregate({
      where: { partnerId, releasedAt: null, confirmedAt: { not: null }, OR: [{ expiresOn: null }, { expiresOn: { gt: today } }] },
      _sum: { amountMinor: true },
    });
    const drawn = await client.partnerSecurityDraw.aggregate({
      where: { security: { partnerId, releasedAt: null, confirmedAt: { not: null }, OR: [{ expiresOn: null }, { expiresOn: { gt: today } }] } },
      _sum: { amountMinor: true },
    });
    return (held._sum.amountMinor ?? 0n) - (drawn._sum.amountMinor ?? 0n);
  }

  static ready(readiness: ActivationReadiness): boolean {
    return Object.values(readiness).every(Boolean);
  }

  static missing(readiness: ActivationReadiness): string[] {
    return (Object.keys(LABELS) as Array<keyof ActivationReadiness>).filter((key) => !readiness[key]).map((key) => LABELS[key]);
  }
}
