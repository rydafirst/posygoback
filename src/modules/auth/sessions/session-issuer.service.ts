import { Injectable } from "@nestjs/common";
import { type AuthenticatedResult, type MfaState, permissionsFor, type SessionUser } from "../../../shared";

import type { AuthPrincipal, RequestMeta } from "../../../common/auth/auth-principal";
import { Errors } from "../../../common/http/app-exception";
import type { DatabaseClient } from "../../../database/prisma.service";
import { AccessTokenService } from "../tokens/access-token.service";
import { type UserProfile, UsersRepository } from "../users.repository";
import { SessionService } from "./session.service";

export interface IssuedAuthentication {
  result: AuthenticatedResult;
  refreshToken: string;
}

@Injectable()
export class SessionIssuerService {
  constructor(
    private readonly sessions: SessionService,
    private readonly accessTokens: AccessTokenService,
    private readonly users: UsersRepository,
  ) {}

  async start(userId: string, mfaState: MfaState, meta: RequestMeta, client?: DatabaseClient): Promise<IssuedAuthentication> {
    const { session, refreshToken } = await this.sessions.create(userId, mfaState, meta, client);
    const result = await this.authenticate(userId, session.id, mfaState);
    return { result, refreshToken };
  }

  async refresh(cookieValue: string, meta: RequestMeta): Promise<IssuedAuthentication> {
    const { session, refreshToken } = await this.sessions.rotate(cookieValue, meta);
    const result = await this.authenticate(session.userId, session.id, session.mfaState);
    return { result, refreshToken };
  }

  async authenticate(userId: string, sessionId: string, mfaState: MfaState): Promise<AuthenticatedResult> {
    const profile = await this.users.findProfile(userId);
    if (!profile || profile.user.status !== "ACTIVE") {
      throw Errors.unauthenticated();
    }
    const principal = this.principalFor(profile, sessionId, mfaState);
    return { status: "AUTHENTICATED", accessToken: await this.accessTokens.sign(principal), user: this.sessionUser(profile, mfaState) };
  }

  async describe(principal: AuthPrincipal): Promise<SessionUser> {
    const profile = await this.users.findProfile(principal.userId);
    if (!profile) {
      throw Errors.unauthenticated();
    }
    return this.sessionUser(profile, principal.mfaState);
  }

  private principalFor(profile: UserProfile, sessionId: string, mfaState: MfaState): AuthPrincipal {
    return {
      userId: profile.user.id,
      sessionId,
      role: profile.user.role,
      vendorId: profile.user.vendorId,
      countryCode: profile.vendorCountryCode ?? profile.user.countryCode,
      partnerId: profile.user.partnerId,
      mfaState,
    };
  }

  private sessionUser(profile: UserProfile, mfaState: MfaState): SessionUser {
    const role = profile.user.role;
    return {
      id: profile.user.id,
      email: profile.user.email,
      role,
      vendorId: profile.user.vendorId,
      businessName: profile.businessName,
      vendorStatus: profile.vendorStatus,
      countryCode: profile.vendorCountryCode ?? profile.user.countryCode,
      currency: profile.currency,
      partnerId: profile.user.partnerId,
      partnerStatus: profile.partnerStatus,
      mfaEnrolled: Boolean(profile.user.mfaEnrolledAt),
      mfaState,
      permissions: mfaState === "ENROLMENT_REQUIRED" ? [] : permissionsFor(role),
    };
  }
}
