import { Injectable, type OnApplicationBootstrap } from "@nestjs/common";

import { standardAgreementsFor } from "../../../database/agreements/standard-agreements";
import { PrismaService } from "../../../database/prisma.service";

@Injectable()
export class StandardAgreementsPublisher implements OnApplicationBootstrap {
  constructor(private readonly prisma: PrismaService) {}

  async onApplicationBootstrap(): Promise<void> {
    const published = await this.prisma.legalDocument.findMany({ distinct: ["countryCode", "kind"], select: { countryCode: true, kind: true } });
    const inUse = new Set(published.map((document) => `${document.countryCode}:${document.kind}`));
    const countries = [...new Set(published.map((document) => document.countryCode))];
    const updates = countries.flatMap((code) => standardAgreementsFor(code)).filter((document) => inUse.has(`${document.countryCode}:${document.kind}`));
    if (updates.length > 0) {
      await this.prisma.legalDocument.createMany({ data: updates, skipDuplicates: true });
    }
  }
}
