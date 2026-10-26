import { NestFactory } from "@nestjs/core";
import type { NestExpressApplication } from "@nestjs/platform-express";
import { Logger } from "nestjs-pino";

import { AppModule } from "./app.module";
import { configureApp } from "./bootstrap";
import { loadEnvironmentFile } from "./config/load-env";
import { loadConfig } from "./config/config.schema";

async function bootstrap(): Promise<void> {
  loadEnvironmentFile();
  const config = loadConfig();
  const app = await NestFactory.create<NestExpressApplication>(AppModule, { bufferLogs: true, bodyParser: false, rawBody: true });
  app.useLogger(app.get(Logger));
  configureApp(app, config);
  await app.listen(config.PORT, "0.0.0.0");
}

bootstrap().catch((error: unknown) => {
  process.stderr.write(`Boot failed: ${String(error)}\n`);
  process.exit(1);
});
