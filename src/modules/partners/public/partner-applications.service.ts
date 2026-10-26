import { Injectable } from "@nestjs/common";

import type { RequestMeta } from "../../../common/auth/auth-principal";
import { Errors } from "../../../common/http/app-exception";
import { PrismaService } from "../../../database/prisma.service";
import { AuditService, SYSTEM_ACTOR } from "../../../infrastructure/audit/audit.service";
import { AttemptLimiterService } from "../../../infrastructure/rate-limit/attempt-limiter.service";
import { PARTNER_CHECK_KINDS, type PartnerApplicationInput, partnerProfileSchema, partnerProgramme } from "../../../shared";
import { StaffService } from "../../staff/staff.service";
import { randomCode } from "../../stock/inbound/references";

const APPLICATIONS_PER_EMAIL = { name: "partner-applications-email", limit: 3, windowSeconds: 24 * 60 * 60 };
const APPLICATIONS_PER_IP = { name: "partner-applications-ip", limit: 10, windowSeconds: 24 * 60 * 60 };

@Injectable()
export class PartnerApplicationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly staff: StaffService,
    private readonly limiter: AttemptLimiterService,
    private readonly audit: AuditService,
  ) {}

  async apply(input: PartnerApplicationInput, meta: RequestMeta): Promise<void> {
    await this.limiter.consume(APPLICATIONS_PER_IP, meta.ip);
    await this.limiter.consume(APPLICATIONS_PER_EMAIL, input.email);
    const country = await this.prisma.country.findFirst({ where: { code: input.countryCode, status: { in: ["ONBOARDING", "LIVE"] } }, select: { code: true, config: true } });
    const programme = country ? partnerProgramme(country.config as { partners?: unknown }) : null;
    if (!country || !programme?.acceptingApplications) {
      throw Errors.validation({ countryCode: ["We're not taking partners in this country yet"] });
    }
    if (await this.alreadyKnown(input.email)) {
      return;
    }
    const { email, countryCode, referee, heardFrom } = input;
    const profile = partnerProfileSchema.parse(input);
    const partner = await this.prisma.$transaction(async (tx) => {
      const created = await tx.fulfilmentPartner.create({
        data: {
          reference: await this.reference(tx, countryCode),
          countryCode,
          kind: "INDIVIDUAL",
          legalName: profile.fullName,
          contactEmail: email,
          profile: { ...profile, heardFrom },
          requiredDepositMinor: BigInt(programme.depositMinor),
          requiredInsuranceMinor: BigInt(programme.insuranceCoverMinor),
        },
      });
      await tx.partnerCheck.createMany({ data: PARTNER_CHECK_KINDS.map((kind) => ({ partnerId: created.id, kind })) });
      await tx.partnerCheck.update({ where: { partnerId_kind: { partnerId: created.id, kind: "REFERRAL" } }, data: { status: "SUBMITTED", details: referee, submittedAt: new Date() } });
      await this.audit.record(
        { actor: SYSTEM_ACTOR, action: "partner.applied", resourceType: "fulfilment_partner", resourceId: created.id, countryCode, after: { reference: created.reference, heardFrom }, meta },
        tx,
      );
      return created;
    });
    await this.staff.inviteApplicant({ email, role: "FULFILMENT_PARTNER", countryCode, partnerId: partner.id }, meta);
  }

  private async alreadyKnown(email: string): Promise<boolean> {
    const user = await this.prisma.user.findUnique({ where: { email }, select: { id: true } });
    const partner = await this.prisma.fulfilmentPartner.findFirst({ where: { contactEmail: email, status: { notIn: ["REJECTED", "TERMINATED"] } }, select: { id: true } });
    return Boolean(user || partner);
  }

  private async reference(tx: Pick<PrismaService, "fulfilmentPartner">, countryCode: string): Promise<string> {
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const reference = `FP-${countryCode}-${randomCode(6)}`;
      if (!(await tx.fulfilmentPartner.findUnique({ where: { reference }, select: { id: true } }))) {
        return reference;
      }
    }
    throw new Error("Could not allocate a partner reference");
  }
}
