import { Inject, Injectable } from "@nestjs/common";

import { Errors } from "../../../common/http/app-exception";
import { APP_CONFIG } from "../../../config/config.module";
import type { AppConfig, PaymentAccount } from "../../../config/config.schema";
import type { PaymentProcessor } from "./payment-processor.port";
import { SandboxProcessor } from "./sandbox.processor";
import { StripeProcessor } from "./stripe.processor";

export interface ResolvedAccount {
  countryCode: string;
  account: PaymentAccount;
  processor: PaymentProcessor;
}

@Injectable()
export class PaymentAccountsService {
  private readonly processors = new Map<string, PaymentProcessor>();

  constructor(@Inject(APP_CONFIG) private readonly config: AppConfig) {}

  forCountry(countryCode: string): ResolvedAccount {
    const account = this.config.PAYMENT_ACCOUNTS[countryCode];
    if (!account) {
      throw Errors.invalidTransition("Top-ups aren't available in your market yet.");
    }
    return { countryCode, account, processor: this.processorFor(countryCode, account) };
  }

  find(countryCode: string): ResolvedAccount | null {
    return this.config.PAYMENT_ACCOUNTS[countryCode] ? this.forCountry(countryCode) : null;
  }

  register(countryCode: string, processor: PaymentProcessor): void {
    this.processors.set(countryCode, processor);
  }

  private processorFor(countryCode: string, account: PaymentAccount): PaymentProcessor {
    const existing = this.processors.get(countryCode);
    if (existing) {
      return existing;
    }
    const created = account.processor === "STRIPE" ? new StripeProcessor(account.secretKey, account.webhookSecret) : new SandboxProcessor(new URL(this.config.WEB_PUBLIC_URL).origin);
    this.processors.set(countryCode, created);
    return created;
  }
}
