import { Module } from "@nestjs/common";

import { DraftsController } from "./drafts.controller";
import { DraftsJobs } from "./drafts.jobs";
import { DraftsService } from "./drafts.service";

@Module({
  controllers: [DraftsController],
  providers: [DraftsService, DraftsJobs],
})
export class DraftsModule {}
