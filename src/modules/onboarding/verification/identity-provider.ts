import { Injectable } from "@nestjs/common";
import type { KycRuleset } from "../../../shared";

export interface IdentityCheckRequest {
  vendorId: string;
  countryCode: string;
}

export interface IdentityCheckReceipt {
  provider: string;
  reference: string;
}

export interface IdentityVerificationProvider {
  readonly name: KycRuleset["provider"];
  submit(request: IdentityCheckRequest): Promise<IdentityCheckReceipt>;
}

export class ManualReviewProvider implements IdentityVerificationProvider {
  readonly name = "MANUAL" as const;

  submit(request: IdentityCheckRequest): Promise<IdentityCheckReceipt> {
    return Promise.resolve({ provider: this.name, reference: `manual:${request.vendorId}:${Date.now()}` });
  }
}

@Injectable()
export class IdentityProviderRegistry {
  private readonly providers: ReadonlyMap<KycRuleset["provider"], IdentityVerificationProvider>;

  constructor() {
    const available: IdentityVerificationProvider[] = [new ManualReviewProvider()];
    this.providers = new Map(available.map((provider) => [provider.name, provider]));
  }

  for(ruleset: Pick<KycRuleset, "provider">): IdentityVerificationProvider {
    const provider = this.providers.get(ruleset.provider ?? "MANUAL");
    if (!provider) {
      throw new Error(`No identity provider registered for ${ruleset.provider}`);
    }
    return provider;
  }
}
