import type { DatabaseClient } from "../../database/prisma.service";

export async function vendorHasHistory(client: DatabaseClient, vendorId: string): Promise<boolean> {
  const where = { vendorId };
  const counts = await Promise.all([
    client.order.count({ where }),
    client.storefrontOrder.count({ where }),
    client.inboundShipment.count({ where }),
    client.stockLot.count({ where }),
    client.storageBox.count({ where }),
    client.inventoryMovement.count({ where }),
    client.custodyEvent.count({ where }),
    client.custodyClaim.count({ where }),
    client.vendorReturn.count({ where }),
    client.ledgerEntry.count({ where }),
    client.topUp.count({ where: { vendorId, status: { in: ["SUCCEEDED", "REFUNDED"] } } }),
    client.vendorActivationPayment.count({ where: { vendorId, status: { in: ["PAID", "REFUNDED"] } } }),
  ]);
  return counts.some((count) => count > 0);
}

export async function partnerHasHistory(client: DatabaseClient, partnerId: string): Promise<boolean> {
  const partner = await client.fulfilmentPartner.findUnique({ where: { id: partnerId }, select: { activatedAt: true } });
  if (partner?.activatedAt) {
    return true;
  }
  const where = { partnerId };
  const counts = await Promise.all([
    client.partnerLedgerEntry.count({ where }),
    client.partnerPayout.count({ where }),
    client.partnerSecurity.count({ where }),
    client.stockCount.count({ where }),
    client.mysteryOrder.count({ where }),
    client.custodyClaim.count({ where }),
    client.custodyAlert.count({ where }),
  ]);
  return counts.some((count) => count > 0);
}
