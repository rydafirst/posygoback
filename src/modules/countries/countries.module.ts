import { Module } from "@nestjs/common";

import { AdminCountriesController, CountriesController } from "./countries.controller";
import { CountriesRepository } from "./countries.repository";
import { CountriesService } from "./countries.service";
import { VendorCountriesRepository } from "./vendor-countries.repository";

@Module({
  controllers: [CountriesController, AdminCountriesController],
  providers: [CountriesRepository, CountriesService, VendorCountriesRepository],
  exports: [CountriesRepository, VendorCountriesRepository],
})
export class CountriesModule {}
