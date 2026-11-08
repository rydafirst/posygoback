import { Injectable } from "@nestjs/common";

import { type DatabaseClient, PrismaService } from "../../../database/prisma.service";
import type { ActivationFeeView } from "../../../shared";

const PLATFORM = 1;

@Injectable()
export class ActivationFeeRepository {
  constructor(private readonly prisma: PrismaService) {}

  async current(client: DatabaseClient = this.prisma): Promise<ActivationFeeView> {
    const settings = await client.platformSetting.findUniqueOrThrow({ where: { id: PLATFORM } });
    return { feeMinor: Number(settings.activationFeeMinor), currency: settings.activationFeeCurrency };
  }

  async update(feeMinor: number, client: DatabaseClient): Promise<ActivationFeeView> {
    const settings = await client.platformSetting.update({ where: { id: PLATFORM }, data: { activationFeeMinor: BigInt(feeMinor), updatedAt: new Date() } });
    return { feeMinor: Number(settings.activationFeeMinor), currency: settings.activationFeeCurrency };
  }
}
