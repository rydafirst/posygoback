import { Global, Module } from "@nestjs/common";

import { LiveUpdatesService } from "./live-updates.service";

@Global()
@Module({
  providers: [LiveUpdatesService],
  exports: [LiveUpdatesService],
})
export class RealtimeModule {}
