import type { DatabaseClient } from "../../../database/prisma.service";

export async function unitsStored(client: DatabaseClient, vendorId: string, warehouseId: string): Promise<number> {
  const sums = await client.stockLot.aggregate({ where: { vendorId, warehouseId }, _sum: { quantityAvailable: true, quantityReserved: true } });
  return (sums._sum.quantityAvailable ?? 0) + (sums._sum.quantityReserved ?? 0);
}

export async function closeEmptyBoxes(client: DatabaseClient, vendorId: string, warehouseId: string, now = new Date()): Promise<number> {
  if ((await unitsStored(client, vendorId, warehouseId)) > 0) {
    return 0;
  }
  const closed = await client.storageBox.updateMany({ where: { vendorId, warehouseId, removedAt: null }, data: { removedAt: now, closedReason: "EMPTY" } });
  return closed.count;
}
