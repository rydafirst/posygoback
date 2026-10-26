import { Inject, Injectable } from "@nestjs/common";
import { JwtService } from "@nestjs/jwt";
import { ROLES } from "../../../shared";
import { z } from "zod";

import { APP_CONFIG } from "../../../config/config.module";
import type { AppConfig } from "../../../config/config.schema";
import type { AuthPrincipal } from "../../../common/auth/auth-principal";

const ISSUER = "gfn-api";
const AUDIENCE = "gfn-web";

const claimsSchema = z.object({
  typ: z.literal("access"),
  sub: z.string().uuid(),
  sid: z.string().uuid(),
  role: z.enum(ROLES),
  vid: z.string().uuid().nullable(),
  cc: z.string().length(2).nullable(),
  pid: z.string().uuid().nullable(),
  mfa: z.enum(["VERIFIED", "NOT_REQUIRED", "ENROLMENT_REQUIRED"]),
});

@Injectable()
export class AccessTokenService {
  constructor(
    private readonly jwt: JwtService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  sign(principal: AuthPrincipal): Promise<string> {
    return this.jwt.signAsync(
      { typ: "access", sid: principal.sessionId, role: principal.role, vid: principal.vendorId, cc: principal.countryCode, pid: principal.partnerId, mfa: principal.mfaState },
      { subject: principal.userId, secret: this.config.JWT_ACCESS_SECRET, expiresIn: this.config.JWT_ACCESS_TTL_SECONDS, issuer: ISSUER, audience: AUDIENCE, algorithm: "HS256" },
    );
  }

  async verify(token: string): Promise<AuthPrincipal | null> {
    try {
      const payload: unknown = await this.jwt.verifyAsync(token, { secret: this.config.JWT_ACCESS_SECRET, issuer: ISSUER, audience: AUDIENCE, algorithms: ["HS256"] });
      const claims = claimsSchema.parse(payload);
      return { userId: claims.sub, sessionId: claims.sid, role: claims.role, vendorId: claims.vid, countryCode: claims.cc, partnerId: claims.pid, mfaState: claims.mfa };
    } catch {
      return null;
    }
  }
}
