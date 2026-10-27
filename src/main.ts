import { NestFactory } from "@nestjs/core";
import type { NestExpressApplication } from "@nestjs/platform-express";
import { Logger } from "nestjs-pino";

import { AppModule } from "./app.module";
import { configureApp } from "./bootstrap";
import { loadEnvironmentFile } from "./config/load-env";
import { loadConfig } from "./config/config.schema";
import { sharesSite } from "./config/same-site";

async function bootstrap(): Promise<void> {
  loadEnvironmentFile();
  const config = loadConfig();
  const app = await NestFactory.create<NestExpressApplication>(AppModule, { bufferLogs: true, bodyParser: false, rawBody: true });
  app.useLogger(app.get(Logger));
  configureApp(app, config);
  if (!sharesSite(config.API_PUBLIC_URL, config.WEB_PUBLIC_URL)) {
    app
      .get(Logger)
      .warn(`API_PUBLIC_URL (${config.API_PUBLIC_URL}) and WEB_PUBLIC_URL (${config.WEB_PUBLIC_URL}) are on different sites, so browsers won't send the sign-in cookie and people get signed out. Serve the API from a subdomain of the website, such as api.posygo.com.`);
  }
  await app.listen(config.PORT, "0.0.0.0");
}

bootstrap().catch((error: unknown) => {
  process.stderr.write(`Boot failed: ${String(error)}\n`);
  process.exit(1);
});
