import { Module } from "@nestjs/common";

import { AdminCountriesController, CountriesController } from "./countries.controller";
import { CountriesRepository } from "./countries.repository";
import { CountriesService } from "./countries.service";

@Module({ controllers: [CountriesController, AdminCountriesController], providers: [CountriesRepository, CountriesService], exports: [CountriesRepository] })
export class CountriesModule {}
