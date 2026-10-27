import { type MiddlewareConsumer, Module, type NestModule } from "@nestjs/common";
import { APP_FILTER, APP_GUARD } from "@nestjs/core";
import { ScheduleModule } from "@nestjs/schedule";
import { LoggerModule } from "nestjs-pino";

import { AccessGuard } from "./common/auth/access.guard";
import { RequestContextMiddleware } from "./common/context/request-context.middleware";
import { AllExceptionsFilter } from "./common/http/all-exceptions.filter";
import { APP_CONFIG, ConfigModule } from "./config/config.module";
import type { AppConfig } from "./config/config.schema";
import { DatabaseModule } from "./database/database.module";
import { AuditModule } from "./infrastructure/audit/audit.module";
import { CryptoModule } from "./infrastructure/crypto/crypto.module";
import { EmailModule } from "./infrastructure/email/email.module";
import { ClientThrottlerGuard } from "./infrastructure/rate-limit/client-throttler.guard";
import { RateLimitModule } from "./infrastructure/rate-limit/rate-limit.module";
import { RedisModule } from "./infrastructure/redis/redis.module";
import { AuditAnchorModule } from "./modules/audit-anchor/audit-anchor.module";
import { AuthModule } from "./modules/auth/auth.module";
import { CommerceModule } from "./modules/commerce/commerce.module";
import { ReturnsModule } from "./modules/returns/returns.module";
import { NotificationsModule } from "./modules/notifications/notifications.module";
import { ExportsModule } from "./modules/exports/exports.module";
import { GrowthModule } from "./modules/growth/growth.module";
import { DashboardModule } from "./modules/dashboard/dashboard.module";
import { CountriesModule } from "./modules/countries/countries.module";
import { FilesModule } from "./modules/files/files.module";
import { HealthController } from "./modules/health/health.controller";
import { OnboardingModule } from "./modules/onboarding/onboarding.module";
import { FinanceModule } from "./modules/finance/finance.module";
import { StaffModule } from "./modules/staff/staff.module";
import { OrdersModule } from "./modules/orders/orders.module";
import { PartnersModule } from "./modules/partners/partners.module";
import { StockModule } from "./modules/stock/stock.module";
import { SupportModule } from "./modules/support/support.module";
import { AssistantModule } from "./modules/assistant/assistant.module";

const REDACT = [
  "req.headers.authorization",
  "req.headers.cookie",
  'req.headers["x-api-key"]',
  'res.headers["set-cookie"]',
  "req.body.password",
  "req.body.code",
  "req.body.recoveryCode",
  "req.body.token",
  "req.body.challengeToken",
];

interface LoggedRequest {
  id?: unknown;
  method?: string;
  url?: string;
  headers?: unknown;
  remoteAddress?: string;
  remotePort?: number;
}

const SECRET_PATH = /(\/webhooks\/[a-z]+\/[A-Z]{2}\/)[^/?]+/;

function maskSecrets(url: string | undefined): string | undefined {
  return url?.replace(SECRET_PATH, "$1[redacted]");
}

@Module({
  imports: [
    ConfigModule,
    LoggerModule.forRootAsync({
      inject: [APP_CONFIG],
      useFactory: (config: AppConfig) => ({
        pinoHttp: {
          level: config.NODE_ENV === "production" ? "info" : config.NODE_ENV === "test" ? "silent" : "debug",
          redact: { paths: REDACT, censor: "[redacted]" },
          genReqId: (request) => (request as unknown as { correlationId?: string }).correlationId ?? "",
          serializers: {
            req: (request: LoggedRequest) => ({
              id: request.id,
              method: request.method,
              url: maskSecrets(request.url),
              headers: request.headers,
              remoteAddress: request.remoteAddress,
              remotePort: request.remotePort,
            }),
          },
          autoLogging: { ignore: (request) => request.url?.startsWith("/v1/health") ?? false },
        },
      }),
    }),
    DatabaseModule,
    RedisModule,
    CryptoModule,
    AuditModule,
    EmailModule,
    RateLimitModule,
    AuthModule,
    AuditAnchorModule,
    CommerceModule,
    SupportModule,
    AssistantModule,
    ReturnsModule,
    NotificationsModule,
    ExportsModule,
    GrowthModule,
    DashboardModule,
    CountriesModule,
    FilesModule,
    OnboardingModule,
    StaffModule,
    FinanceModule,
    StockModule,
    OrdersModule,
    PartnersModule,
    ScheduleModule.forRoot(),
  ],
  controllers: [HealthController],
  providers: [
    { provide: APP_FILTER, useClass: AllExceptionsFilter },
    { provide: APP_GUARD, useClass: AccessGuard },
    { provide: APP_GUARD, useClass: ClientThrottlerGuard },
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(RequestContextMiddleware).forRoutes("*path");
  }
}
