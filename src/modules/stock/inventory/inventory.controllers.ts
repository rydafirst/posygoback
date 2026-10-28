import { Body, Controller, Get, HttpCode, HttpStatus, Param, ParseUUIDPipe, Post, Query } from "@nestjs/common";
import { type PlaceLotInput, placeLotSchema } from "../../../shared";
import { z } from "zod";

import type { AuthPrincipal, RequestMeta } from "../../../common/auth/auth-principal";
import { CurrentPrincipal, Meta, RequirePermission } from "../../../common/auth/decorators";
import { type SellerCountry, SelectedCountry } from "../../../common/auth/selected-country";
import { ZodValidationPipe } from "../../../common/http/zod-validation.pipe";
import { InventoryService } from "./inventory.service";

const uuid = new ParseUUIDPipe({ version: "4" });
const optionalUuid = new ZodValidationPipe(z.string().uuid().optional());
const unplacedQuery = new ZodValidationPipe(z.enum(["true", "false"]).optional());
const labelsBody = new ZodValidationPipe(z.object({ productIds: z.array(z.string().uuid()).min(1).max(200) }));

@Controller({ path: "vendor/inventory", version: "1" })
export class VendorInventoryController {
  constructor(private readonly inventory: InventoryService) {}

  @RequirePermission("vendor.stock.read")
  @Get("lots")
  lots(@SelectedCountry() country: SellerCountry, @Query("productId", optionalUuid) productId?: string) {
    return this.inventory.vendorLots(country, productId);
  }

  @RequirePermission("vendor.stock.read")
  @Get("movements")
  movements(@SelectedCountry() country: SellerCountry) {
    return this.inventory.vendorMovements(country);
  }

  @RequirePermission("vendor.stock.read")
  @Get("lots/:id/custody")
  custody(@Param("id", uuid) id: string, @CurrentPrincipal() principal: AuthPrincipal) {
    return this.inventory.vendorCustody(principal, id);
  }

  @RequirePermission("vendor.stock.read")
  @Post("labels")
  @HttpCode(HttpStatus.OK)
  labels(@Body(labelsBody) input: { productIds: string[] }, @CurrentPrincipal() principal: AuthPrincipal) {
    return this.inventory.vendorProductLabels(principal, input.productIds);
  }
}

@Controller({ path: "warehouse", version: "1" })
export class WarehouseInventoryController {
  constructor(private readonly inventory: InventoryService) {}

  @RequirePermission("inventory.read")
  @Get("warehouses/:warehouseId/lots")
  lots(@Param("warehouseId", uuid) warehouseId: string, @CurrentPrincipal() principal: AuthPrincipal, @Query("unplaced", unplacedQuery) unplaced?: "true" | "false") {
    return this.inventory.warehouseLots(principal, warehouseId, unplaced === "true");
  }

  @RequirePermission("inventory.read")
  @Get("lots/:id/custody")
  custody(@Param("id", uuid) id: string, @CurrentPrincipal() principal: AuthPrincipal) {
    return this.inventory.warehouseCustody(principal, id);
  }

  @RequirePermission("inventory.place")
  @Post("lots/:id/location")
  @HttpCode(HttpStatus.OK)
  place(@Param("id", uuid) id: string, @Body(new ZodValidationPipe(placeLotSchema)) input: PlaceLotInput, @CurrentPrincipal() principal: AuthPrincipal, @Meta() meta: RequestMeta) {
    return this.inventory.place(principal, id, input.locationId, meta);
  }

  @RequirePermission("inbound.read")
  @Get("inbound/:id/labels")
  labels(@Param("id", uuid) id: string, @CurrentPrincipal() principal: AuthPrincipal) {
    return this.inventory.warehouseLotLabels(principal, id);
  }
}
