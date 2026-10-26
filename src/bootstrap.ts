import { type INestApplication, VersioningType } from "@nestjs/common";
import type { NestExpressApplication } from "@nestjs/platform-express";
import cookieParser from "cookie-parser";
import { json } from "express";
import helmet from "helmet";

import type { AppConfig } from "./config/config.schema";

export function configureApp(app: INestApplication, config: AppConfig): void {
  const express = app as NestExpressApplication;
  express.set("trust proxy", config.TRUST_PROXY_HOPS);
  express.disable("x-powered-by");
  app.use("/v1/vendor/orders/imports", json({ limit: "300kb" }));
  express.useBodyParser("json", { limit: "100kb" });

  app.enableCors({
    origin: [new URL(config.WEB_PUBLIC_URL).origin],
    credentials: true,
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE"],
    allowedHeaders: ["Authorization", "Content-Type", "X-Correlation-Id", "Idempotency-Key"],
    exposedHeaders: ["X-Correlation-Id", "Retry-After"],
    maxAge: 600,
  });
  app.use(
    helmet({
      contentSecurityPolicy: { useDefaults: false, directives: { defaultSrc: ["'none'"], frameAncestors: ["'none'"], baseUri: ["'none'"], formAction: ["'none'"] } },
      crossOriginResourcePolicy: { policy: "same-site" },
      hsts: { maxAge: 63_072_000, includeSubDomains: true, preload: true },
      referrerPolicy: { policy: "no-referrer" },
    }),
  );
  app.use(cookieParser());
  app.enableVersioning({ type: VersioningType.URI });
  app.enableShutdownHooks();
}
