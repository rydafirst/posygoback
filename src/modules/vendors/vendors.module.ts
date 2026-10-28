import { Module } from "@nestjs/common";

import { ProductDirectoryService } from "./product-directory.service";
import { StockFiguresRepository } from "./stock-figures.repository";
import { VendorDirectoryService } from "./vendor-directory.service";
import { AdminProductsController, AdminVendorsController } from "./vendors.controllers";

@Module({ controllers: [AdminVendorsController, AdminProductsController], providers: [VendorDirectoryService, ProductDirectoryService, StockFiguresRepository] })
export class VendorsModule {}
