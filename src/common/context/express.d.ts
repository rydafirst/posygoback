import type { AuthPrincipal } from "../auth/auth-principal";

declare global {
  namespace Express {
    interface Request {
      correlationId: string;
      clientIp: string;
      principal?: AuthPrincipal;
      buyerId?: string;
    }
  }
}

export {};
