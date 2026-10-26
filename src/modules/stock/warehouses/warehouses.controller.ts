import { Body, Controller, Get, HttpCode, HttpStatus, Param, ParseUUIDPipe, Post } from "@nestjs/common";
import { type LocationInput, locationInputSchema, type WarehouseInput, warehouseInputSchema } from "../../../shared";
import { z } from "zod";

import type { AuthPrincipal, RequestMeta } from "../../../common/auth/auth-principal";
import { CurrentPrincipal, Meta, RequirePermission } from "../../../common/auth/decorators";
import { ZodValidationPipe } from "../../../common/http/zod-validation.pipe";
import { WarehousesService } from "./warehouses.service";

const uuid = new ParseUUIDPipe({ version: "4" });
const activeBody = new ZodValidationPipe(z.object({ active: z.boolean() }));

@Controller({ path: "warehouse/warehouses", version: "1" })
export class WarehousesController {
  constructor(private readonly warehouses: WarehousesService) {}

  @RequirePermission("warehouses.read")
  @Get()
  list(@CurrentPrincipal() principal: AuthPrincipal) {
    return this.warehouses.list(principal);
  }

  @RequirePermission("warehouses.read")
  @Get(":id")
  get(@Param("id", uuid) id: string, @CurrentPrincipal() principal: AuthPrincipal) {
    return this.warehouses.get(principal, id);
  }

  @RequirePermission("warehouses.manage")
  @Post()
  create(@Body(new ZodValidationPipe(warehouseInputSchema)) input: WarehouseInput, @CurrentPrincipal() principal: AuthPrincipal, @Meta() meta: RequestMeta) {
    return this.warehouses.create(principal, input, meta);
  }

  @RequirePermission("warehouses.manage")
  @Post(":id/active")
  @HttpCode(HttpStatus.OK)
  setActive(@Param("id", uuid) id: string, @Body(activeBody) input: { active: boolean }, @CurrentPrincipal() principal: AuthPrincipal, @Meta() meta: RequestMeta) {
    return this.warehouses.setActive(principal, id, input.active, meta);
  }

  @RequirePermission("warehouses.read")
  @Get(":id/locations")
  locations(@Param("id", uuid) id: string, @CurrentPrincipal() principal: AuthPrincipal) {
    return this.warehouses.locations(principal, id);
  }

  @RequirePermission("warehouse.locations.manage")
  @Post(":id/locations")
  @HttpCode(HttpStatus.CREATED)
  createLocation(@Param("id", uuid) id: string, @Body(new ZodValidationPipe(locationInputSchema)) input: LocationInput, @CurrentPrincipal() principal: AuthPrincipal, @Meta() meta: RequestMeta) {
    return this.warehouses.createLocation(principal, id, input, meta);
  }

  @RequirePermission("warehouse.locations.manage")
  @Post(":id/locations/:locationId/active")
  @HttpCode(HttpStatus.NO_CONTENT)
  setLocationActive(
    @Param("id", uuid) id: string,
    @Param("locationId", uuid) locationId: string,
    @Body(activeBody) input: { active: boolean },
    @CurrentPrincipal() principal: AuthPrincipal,
    @Meta() meta: RequestMeta,
  ) {
    return this.warehouses.setLocationActive(principal, id, locationId, input.active, meta);
  }
}
