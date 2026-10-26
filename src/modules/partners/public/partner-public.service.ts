import { Injectable } from "@nestjs/common";

import { PrismaService } from "../../../database/prisma.service";
import { type FeeSchedule, fulfilmentFee, type HubView, partnerProgramme, type PartnerProgrammeView, partnerRates, partnerShare } from "../../../shared";

const EXAMPLE = { boxesReceived: 20, boxesStored: 30, ordersPacked: 100 };

@Injectable()
export class PartnerPublicService {
  constructor(private readonly prisma: PrismaService) {}

  async hubs(): Promise<HubView[]> {
    const countries = await this.prisma.country.findMany({
      where: { status: "LIVE", warehouses: { some: { active: true, OR: [{ partnerId: null }, { partner: { status: "ACTIVE" } }] } } },
      select: { code: true, name: true, currency: true, config: true },
      orderBy: { name: "asc" },
    });
    return countries.map((country) => ({
      countryCode: country.code,
      countryName: country.name,
      currency: country.currency,
      insuredCoverMinor: partnerProgramme(country.config as { partners?: unknown }).platformInsuranceCoverMinor,
    }));
  }

  async programmes(): Promise<PartnerProgrammeView[]> {
    const countries = await this.prisma.country.findMany({
      where: { status: { in: ["ONBOARDING", "LIVE"] } },
      select: { code: true, name: true, currency: true, config: true, feeSchedules: { where: { status: "ACTIVE" }, select: { schedule: true }, take: 1 } },
      orderBy: { name: "asc" },
    });
    const views: PartnerProgrammeView[] = [];
    for (const country of countries) {
      const schedule = country.feeSchedules[0]?.schedule as unknown as FeeSchedule | undefined;
      if (!schedule || !partnerProgramme(country.config as { partners?: unknown }).acceptingApplications) {
        continue;
      }
      const rates = partnerRates(schedule);
      const founders = await this.prisma.fulfilmentPartner.count({ where: { countryCode: country.code, founding: true } });
      views.push({
        countryCode: country.code,
        countryName: country.name,
        currency: country.currency,
        receivingShareBps: rates.receivingShareBps,
        storageShareBps: rates.storageShareBps,
        fulfilmentShareBps: rates.fulfilmentShareBps,
        foundingBonusBps: rates.foundingBonusBps,
        foundingPlacesLeft: Math.max(0, rates.foundingPlaces - founders),
        holdbackBps: rates.holdbackBps,
        holdbackDays: rates.holdbackDays,
        example: { ...EXAMPLE, monthlyMinor: this.exampleMonth(schedule) },
      });
    }
    return views;
  }

  private exampleMonth(schedule: FeeSchedule): number {
    const rates = partnerRates(schedule);
    const small = schedule.onboarding.SMALL;
    const receiving = small.negotiated
      ? 0
      : partnerShare(EXAMPLE.boxesReceived * small.stockingMinor, rates.receivingShareBps, false, rates) +
        partnerShare(EXAMPLE.boxesReceived * small.firstMonthStorageMinor, rates.storageShareBps, false, rates);
    const storage = partnerShare(EXAMPLE.boxesStored * (schedule.monthlyStorage.SMALL ?? 0), rates.storageShareBps, false, rates);
    const packing = partnerShare(EXAMPLE.ordersPacked * fulfilmentFee(schedule, 1), rates.fulfilmentShareBps, false, rates);
    return receiving + storage + packing;
  }
}
