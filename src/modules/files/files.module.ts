import { Module } from "@nestjs/common";

import { APP_CONFIG } from "../../config/config.module";
import type { AppConfig } from "../../config/config.schema";
import { FilesController } from "./files.controller";
import { FilesService } from "./files.service";
import { OBJECT_STORAGE } from "./storage/object-storage.port";
import { S3ObjectStorage } from "./storage/s3-object-storage";

@Module({
  controllers: [FilesController],
  providers: [FilesService, { provide: OBJECT_STORAGE, inject: [APP_CONFIG], useFactory: (config: AppConfig) => new S3ObjectStorage(config) }],
  exports: [FilesService, OBJECT_STORAGE],
})
export class FilesModule {}
