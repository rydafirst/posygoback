import { Inject, Injectable } from "@nestjs/common";

import { Errors } from "../../../common/http/app-exception";
import { APP_CONFIG } from "../../../config/config.module";
import type { AppConfig, CarrierAccount } from "../../../config/config.schema";
import type { CarrierAdapter } from "./carrier.port";
import { SandboxCarrier } from "./sandbox.carrier";
import { ShippoCarrier } from "./shippo.carrier";

export interface ResolvedCarrier {
  countryCode: string;
  account: CarrierAccount;
  adapter: CarrierAdapter;
}

@Injectable()
export class CarrierAccountsService {
  private readonly adapters = new Map<string, CarrierAdapter>();

  constructor(@Inject(APP_CONFIG) private readonly config: AppConfig) {}

  forCountry(countryCode: string): ResolvedCarrier {
    const resolved = this.find(countryCode);
    if (!resolved) {
      throw Errors.invalidTransition("Shipping isn't set up for this warehouse's country yet.");
    }
    return resolved;
  }

  find(countryCode: string): ResolvedCarrier | null {
    const account = this.config.CARRIER_ACCOUNTS[countryCode];
    if (!account) {
      return null;
    }
    let adapter = this.adapters.get(countryCode);
    if (!adapter) {
      adapter = account.provider === "SHIPPO" ? new ShippoCarrier(account.apiKey) : new SandboxCarrier();
      this.adapters.set(countryCode, adapter);
    }
    return { countryCode, account, adapter };
  }

  register(countryCode: string, adapter: CarrierAdapter): void {
    this.adapters.set(countryCode, adapter);
  }
}
