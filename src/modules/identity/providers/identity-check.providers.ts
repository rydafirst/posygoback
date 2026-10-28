import { Logger, type Provider } from "@nestjs/common";

import { APP_CONFIG } from "../../../config/config.module";
import { type AppConfig, identityProviderOf } from "../../../config/config.schema";
import { DiditIdentityProvider } from "./didit-identity-provider";
import { IDENTITY_CHECK_PROVIDER, type IdentityCheckProvider } from "./identity-check.port";
import { PracticeIdentityProvider } from "./practice-identity-provider";
import { StripeIdentityProvider } from "./stripe-identity-provider";

export function identityCheckProviderFor(config: AppConfig): IdentityCheckProvider {
  const chosen = identityProviderOf(config);
  if (config.IDENTITY_PROVIDER && chosen !== config.IDENTITY_PROVIDER) {
    new Logger("IdentityChecks").warn(`IDENTITY_PROVIDER is ${config.IDENTITY_PROVIDER} but its settings are missing, so practice identity checks are in use`);
  }
  const services = config.PARTNER_SERVICES;
  if (chosen === "didit") {
    return new DiditIdentityProvider({ apiKey: config.DIDIT_API_KEY, workflowId: config.DIDIT_WORKFLOW_ID, webhookSecret: config.DIDIT_WEBHOOK_SECRET, apiUrl: config.DIDIT_API_URL });
  }
  if (chosen === "stripe" && services.provider === "STRIPE") {
    return new StripeIdentityProvider(services.secretKey, services.identityWebhookSecret);
  }
  return new PracticeIdentityProvider();
}

export const IDENTITY_CHECK_PROVIDERS: Provider[] = [{ provide: IDENTITY_CHECK_PROVIDER, inject: [APP_CONFIG], useFactory: identityCheckProviderFor }];
