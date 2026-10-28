import { Controller, Get, Param, ParseUUIDPipe, Query } from "@nestjs/common";

import type { AuthPrincipal } from "../../common/auth/auth-principal";
import { CurrentPrincipal, RequirePermission } from "../../common/auth/decorators";
import { ZodValidationPipe } from "../../common/http/zod-validation.pipe";
import { type ProductDirectoryQuery, productDirectoryQuerySchema, type VendorDirectoryQuery, vendorDirectoryQuerySchema } from "../../shared";
import { ProductDirectoryService } from "./product-directory.service";
import { VendorDirectoryService } from "./vendor-directory.service";

const uuid = new ParseUUIDPipe({ version: "4" });

@Controller({ path: "admin/vendors", version: "1" })
export class AdminVendorsController {
  constructor(private readonly vendors: VendorDirectoryService) {}

  @RequirePermission("vendors.read")
  @Get()
  list(@CurrentPrincipal() principal: AuthPrincipal, @Query(new ZodValidationPipe(vendorDirectoryQuerySchema)) query: VendorDirectoryQuery) {
    return this.vendors.list(principal, query);
  }

  @RequirePermission("vendors.read")
  @Get(":id")
  detail(@CurrentPrincipal() principal: AuthPrincipal, @Param("id", uuid) id: string) {
    return this.vendors.detail(principal, id);
  }
}

@Controller({ path: "admin/products", version: "1" })
export class AdminProductsController {
  constructor(private readonly products: ProductDirectoryService) {}

  @RequirePermission("vendors.read")
  @Get()
  list(@CurrentPrincipal() principal: AuthPrincipal, @Query(new ZodValidationPipe(productDirectoryQuerySchema)) query: ProductDirectoryQuery) {
    return this.products.list(principal, query);
  }
}
