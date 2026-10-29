import type { Warehouse } from "../../../generated/prisma/client";
import type { CarrierAccount } from "../../../config/config.schema";
import type { ShipmentParty } from "./carrier.port";

export function senderFor(warehouse: Warehouse, businessName: string, account: CarrierAccount): ShipmentParty {
  const addressLines = warehouse.addressLines as string[];
  return {
    name: businessName.slice(0, 100),
    line1: addressLines[0] ?? "",
    line2: addressLines[1],
    city: warehouse.city,
    postalCode: warehouse.postalCode,
    countryCode: warehouse.countryCode,
    phone: account.provider === "SHIPPO" ? account.senderPhone : undefined,
    email: account.provider === "SHIPPO" ? account.senderEmail : undefined,
  };
}
