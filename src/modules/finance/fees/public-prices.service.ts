import { Injectable } from "@nestjs/common";

import { Errors } from "../../../common/http/app-exception";
import { PrismaService } from "../../../database/prisma.service";
import { type PublicPriceListView, shoppingRates, vendorFeeSchedule } from "../../../shared";
import { FeeSchedulesService } from "./fee-schedules.service";

@Injectable()
export class PublicPricesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly fees: FeeSchedulesService,
  ) {}

  async forCountry(countryCode: string): Promise<PublicPriceListView> {
    const country = await this.prisma.country.findUnique({ where: { code: countryCode }, select: { name: true, status: true } });
    if (country?.status !== "LIVE") {
      throw Errors.notFound();
    }
    const { currency, schedule } = await this.fees.active(countryCode);
    return { countryCode, countryName: country.name, currency, schedule: vendorFeeSchedule(schedule), shopping: shoppingRates(schedule) };
  }
}
