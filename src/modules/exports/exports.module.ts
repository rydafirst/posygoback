import { Module } from "@nestjs/common";

import { VendorExportsController } from "./exports.controller";
import { VendorExportsService } from "./vendor-exports.service";

@Module({ controllers: [VendorExportsController], providers: [VendorExportsService] })
export class ExportsModule {}
