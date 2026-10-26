import type { Provider } from "@nestjs/common";

import { APP_CONFIG } from "../../../config/config.module";
import type { AppConfig } from "../../../config/config.schema";
import { IDENTITY_VERIFIER, type IdentityVerifier, PAYOUT_GATEWAY, type PayoutGateway } from "./partner-services.port";
import { PracticeIdentityVerifier, PracticePayoutGateway } from "./practice-partner-services";
import { StripeConnectGateway, StripeIdentityVerifier } from "./stripe-partner-services";

export const PARTNER_SERVICE_PROVIDERS: Provider[] = [
  {
    provide: IDENTITY_VERIFIER,
    inject: [APP_CONFIG],
    useFactory: (config: AppConfig): IdentityVerifier => {
      const services = config.PARTNER_SERVICES;
      return services.provider === "STRIPE" ? new StripeIdentityVerifier(services.secretKey, services.identityWebhookSecret) : new PracticeIdentityVerifier();
    },
  },
  {
    provide: PAYOUT_GATEWAY,
    inject: [APP_CONFIG],
    useFactory: (config: AppConfig): PayoutGateway => {
      const services = config.PARTNER_SERVICES;
      return services.provider === "STRIPE" ? new StripeConnectGateway(services.secretKey, services.connectWebhookSecret) : new PracticePayoutGateway();
    },
  },
];
