import { createParamDecorator, type ExecutionContext, Injectable, type PipeTransform } from "@nestjs/common";
import type { Request } from "express";

import { PrismaService } from "../../database/prisma.service";
import { SELECTED_COUNTRY_PARAM } from "../../shared";
import { Errors } from "../http/app-exception";

export interface SellerCountry {
  vendorId: string;
  countryCode: string;
  currency: string;
}

interface CountryRequest {
  vendorId: string | null;
  requested: unknown;
}

const countryRequest = createParamDecorator((_data: unknown, context: ExecutionContext): CountryRequest => {
  const request = context.switchToHttp().getRequest<Request>();
  return { vendorId: request.principal?.vendorId ?? null, requested: request.query[SELECTED_COUNTRY_PARAM] };
});

@Injectable()
export class SellerCountryPipe implements PipeTransform<CountryRequest, Promise<SellerCountry>> {
  constructor(private readonly prisma: PrismaService) {}

  async transform({ vendorId, requested }: CountryRequest): Promise<SellerCountry> {
    if (!vendorId) {
      throw Errors.notFound();
    }
    if (requested === undefined) {
      return this.home(vendorId);
    }
    if (typeof requested !== "string" || !/^[A-Z]{2}$/.test(requested)) {
      throw Errors.validation({ [SELECTED_COUNTRY_PARAM]: ["Use a two-letter country code"] });
    }
    const added = await this.prisma.vendorCountry.findUnique({ where: { vendorId_countryCode: { vendorId, countryCode: requested } }, select: { country: { select: { currency: true } } } });
    if (!added) {
      throw Errors.validation({ [SELECTED_COUNTRY_PARAM]: ["You don't store stock in this country"] });
    }
    return { vendorId, countryCode: requested, currency: added.country.currency };
  }

  private async home(vendorId: string): Promise<SellerCountry> {
    const vendor = await this.prisma.vendor.findUnique({ where: { id: vendorId }, select: { countryCode: true, country: { select: { currency: true } } } });
    if (!vendor) {
      throw Errors.notFound();
    }
    return { vendorId, countryCode: vendor.countryCode, currency: vendor.country.currency };
  }
}

export const SelectedCountry = () => countryRequest(undefined, SellerCountryPipe);
