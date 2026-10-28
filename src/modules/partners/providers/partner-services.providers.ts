import type { Provider } from "@nestjs/common";

import { APP_CONFIG } from "../../../config/config.module";
import type { AppConfig } from "../../../config/config.schema";
import { PAYOUT_GATEWAY, type PayoutGateway } from "./partner-services.port";
import { PracticePayoutGateway } from "./practice-partner-services";
import { StripeConnectGateway } from "./stripe-partner-services";

export const PARTNER_SERVICE_PROVIDERS: Provider[] = [
  {
    provide: PAYOUT_GATEWAY,
    inject: [APP_CONFIG],
    useFactory: (config: AppConfig): PayoutGateway => {
      const services = config.PARTNER_SERVICES;
      return services.provider === "STRIPE" ? new StripeConnectGateway(services.secretKey, services.connectWebhookSecret) : new PracticePayoutGateway();
    },
  },
];
