import { Inject, Injectable } from "@nestjs/common";
import { acceptsNewVendors, type SignupInput } from "../../../shared";

import type { RequestMeta } from "../../../common/auth/auth-principal";
import { Errors } from "../../../common/http/app-exception";
import { APP_CONFIG } from "../../../config/config.module";
import type { AppConfig } from "../../../config/config.schema";
import { PrismaService } from "../../../database/prisma.service";
import { AuditService } from "../../../infrastructure/audit/audit.service";
import { EMAIL_SENDER, type EmailSender } from "../../../infrastructure/email/email.port";
import { ATTEMPT_POLICIES, AttemptLimiterService } from "../../../infrastructure/rate-limit/attempt-limiter.service";
import { CountriesRepository } from "../../countries/countries.repository";
import { type OpenCountry, VendorCountriesRepository } from "../../countries/vendor-countries.repository";
import { AuthEmails } from "../auth-emails";
import { VerificationCodeService } from "../codes/verification-code.service";
import { PasswordService } from "../password/password.service";
import { UsersRepository } from "../users.repository";

export interface SignupAccepted {
  status: "VERIFICATION_SENT";
}

const UNIQUE_VIOLATION = "23505";

@Injectable()
export class SignupService {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(EMAIL_SENDER) private readonly email: EmailSender,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    private readonly users: UsersRepository,
    private readonly countries: CountriesRepository,
    private readonly vendorCountries: VendorCountriesRepository,
    private readonly passwords: PasswordService,
    private readonly codes: VerificationCodeService,
    private readonly limiter: AttemptLimiterService,
    private readonly audit: AuditService,
  ) {}

  async signup(input: SignupInput, meta: RequestMeta): Promise<SignupAccepted> {
    await this.limiter.consume(ATTEMPT_POLICIES.signupPerIp, meta.ip);
    await this.limiter.consume(ATTEMPT_POLICIES.signupPerEmail, input.email);
    const countries = await this.openCountries(input.countryCodes);
    const homeCountryCode = countries[0]!.code;
    const passwordHash = await this.passwords.hashNew(input.password);
    const existing = await this.users.findByEmail(input.email);
    if (existing?.status === "PENDING_EMAIL_VERIFICATION") {
      const code = await this.prisma.$transaction(async (tx) => {
        await this.users.replacePendingSignup(existing, { ...input, countryCode: homeCountryCode, passwordHash }, tx);
        if (existing.vendorId) {
          await this.vendorCountries.replace(tx, existing.vendorId, countries);
        }
        return this.codes.issueNumeric(existing.id, "EMAIL_VERIFICATION", tx);
      });
      await this.email.send(AuthEmails.verifyEmail(existing.email, code));
      return { status: "VERIFICATION_SENT" };
    }
    if (existing) {
      await this.email.send(AuthEmails.accountAlreadyExists(existing.email, this.config.WEB_PUBLIC_URL));
      return { status: "VERIFICATION_SENT" };
    }
    try {
      const code = await this.prisma.$transaction(async (tx) => {
        const user = await this.users.createVendorOwner({ ...input, countryCode: homeCountryCode, passwordHash }, tx);
        await this.vendorCountries.open(tx, user.vendorId!, countries);
        await this.audit.record(
          {
            actor: { userId: user.id, role: "VENDOR_OWNER" },
            action: "auth.signed_up",
            resourceType: "user",
            resourceId: user.id,
            countryCode: homeCountryCode,
            vendorId: user.vendorId,
            after: { email: user.email, businessName: input.businessName, countries: input.countryCodes },
            meta,
          },
          tx,
        );
        return this.codes.issueNumeric(user.id, "EMAIL_VERIFICATION", tx);
      });
      await this.email.send(AuthEmails.verifyEmail(input.email, code));
    } catch (error) {
      if (!isUniqueViolation(error)) {
        throw error;
      }
    }
    return { status: "VERIFICATION_SENT" };
  }

  private async openCountries(codes: readonly string[]): Promise<OpenCountry[]> {
    const countries = await Promise.all(codes.map((code) => this.countries.findByCode(code)));
    if (countries.some((country) => !country || !acceptsNewVendors(country.status))) {
      throw Errors.countryUnavailable();
    }
    return countries.map((country) => ({ code: country!.code, currency: country!.currency }));
  }
}

function isUniqueViolation(error: unknown): boolean {
  const cause = (error as { cause?: { code?: string }; code?: string }) ?? {};
  return cause.code === UNIQUE_VIOLATION || cause.cause?.code === UNIQUE_VIOLATION;
}
