import type { MfaState, Role } from "../../shared";

export interface AuthPrincipal {
  userId: string;
  sessionId: string;
  role: Role;
  vendorId: string | null;
  countryCode: string | null;
  partnerId: string | null;
  mfaState: MfaState;
}

export interface RequestMeta {
  ip: string;
  userAgent: string | null;
  correlationId: string;
}
