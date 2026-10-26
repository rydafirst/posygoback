import { Controller, Get, Header, Query, Res } from "@nestjs/common";
import { Throttle } from "@nestjs/throttler";
import type { Response } from "express";

import type { AuthPrincipal, RequestMeta } from "../../common/auth/auth-principal";
import { CurrentPrincipal, Meta, RequirePermission } from "../../common/auth/decorators";
import { ZodValidationPipe } from "../../common/http/zod-validation.pipe";
import { type ExportRange, exportRangeSchema } from "../../shared";
import type { CsvFile } from "./vendor-exports.service";
import { VendorExportsService } from "./vendor-exports.service";

const range = new ZodValidationPipe(exportRangeSchema);
const EXPORT_THROTTLE = { default: { limit: 6, ttl: 60_000 } };

function send(response: Response, file: CsvFile): string {
  response.setHeader("Content-Disposition", `attachment; filename="${file.filename}"`);
  return file.body;
}

@Throttle(EXPORT_THROTTLE)
@Controller({ path: "vendor/exports", version: "1" })
export class VendorExportsController {
  constructor(private readonly exports: VendorExportsService) {}

  @RequirePermission("vendor.orders.read")
  @Get("orders.csv")
  @Header("Content-Type", "text/csv; charset=utf-8")
  async orders(@CurrentPrincipal() principal: AuthPrincipal, @Query(range) input: ExportRange, @Meta() meta: RequestMeta, @Res({ passthrough: true }) response: Response) {
    return send(response, await this.exports.orders(principal, input, meta));
  }

  @RequirePermission("vendor.wallet.read")
  @Get("ledger.csv")
  @Header("Content-Type", "text/csv; charset=utf-8")
  async ledger(@CurrentPrincipal() principal: AuthPrincipal, @Query(range) input: ExportRange, @Meta() meta: RequestMeta, @Res({ passthrough: true }) response: Response) {
    return send(response, await this.exports.ledger(principal, input, meta));
  }

  @RequirePermission("vendor.stock.read")
  @Get("inventory.csv")
  @Header("Content-Type", "text/csv; charset=utf-8")
  async inventory(@CurrentPrincipal() principal: AuthPrincipal, @Meta() meta: RequestMeta, @Res({ passthrough: true }) response: Response) {
    return send(response, await this.exports.inventory(principal, meta));
  }
}
