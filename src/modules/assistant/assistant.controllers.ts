import { Body, Controller, Get, HttpCode, HttpStatus, Post, Query } from "@nestjs/common";
import { Throttle } from "@nestjs/throttler";
import { z } from "zod";

import type { AuthPrincipal, RequestMeta } from "../../common/auth/auth-principal";
import { AllowPendingMfa, CurrentPrincipal, Meta, Public, RequirePermission } from "../../common/auth/decorators";
import { ZodValidationPipe } from "../../common/http/zod-validation.pipe";
import { THROTTLE } from "../../infrastructure/rate-limit/rate-limit.module";
import { type AskAssistant, askAssistantSchema, type AssistantStatusView } from "../../shared";
import { AssistantAnswersService } from "./assistant-answers.service";
import { AssistantUsageService } from "./assistant-usage.service";

const askPipe = new ZodValidationPipe(askAssistantSchema);
const daysPipe = new ZodValidationPipe(z.coerce.number().int().min(1).max(90).default(1));

@Controller({ path: "public/assistant", version: "1" })
export class PublicAssistantController {
  constructor(private readonly answers: AssistantAnswersService) {}

  @Public()
  @Throttle(THROTTLE.publicRead)
  @Get("status")
  status(): AssistantStatusView {
    return { answers: this.answers.enabled };
  }

  @Public()
  @Throttle(THROTTLE.auth)
  @Post("answers")
  @HttpCode(HttpStatus.OK)
  ask(@Body(askPipe) input: AskAssistant, @Meta() meta: RequestMeta) {
    return this.answers.ask(input, meta, null);
  }
}

@Controller({ path: "assistant", version: "1" })
export class AssistantController {
  constructor(private readonly answers: AssistantAnswersService) {}

  @AllowPendingMfa()
  @Throttle(THROTTLE.auth)
  @Post("answers")
  @HttpCode(HttpStatus.OK)
  ask(@Body(askPipe) input: AskAssistant, @Meta() meta: RequestMeta, @CurrentPrincipal() principal: AuthPrincipal) {
    return this.answers.ask(input, meta, principal);
  }
}

@Controller({ path: "admin/assistant", version: "1" })
export class AdminAssistantController {
  constructor(private readonly usage: AssistantUsageService) {}

  @RequirePermission("support.read")
  @Get("gaps")
  gaps() {
    return this.usage.gaps();
  }

  @RequirePermission("support.read")
  @Get("usage")
  summary(@Query("days", daysPipe) days: number) {
    return this.usage.usage(days);
  }
}
