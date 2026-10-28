import { type ArgumentsHost, Catch, type ExceptionFilter, HttpException, HttpStatus, Logger, Optional } from "@nestjs/common";
import { ThrottlerException } from "@nestjs/throttler";
import { type ApiErrorBody, ERROR_CODES } from "../../shared";
import type { Request, Response } from "express";

import { SupportCasesService } from "../../modules/support/support-cases.service";
import { AppException } from "./app-exception";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const STATUS_CODES: Partial<Record<number, string>> = {
  [HttpStatus.UNAUTHORIZED]: ERROR_CODES.unauthenticated,
  [HttpStatus.FORBIDDEN]: ERROR_CODES.forbidden,
  [HttpStatus.NOT_FOUND]: ERROR_CODES.notFound,
  [HttpStatus.TOO_MANY_REQUESTS]: ERROR_CODES.rateLimited,
};

@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger(AllExceptionsFilter.name);

  constructor(@Optional() private readonly support?: SupportCasesService) {}

  catch(exception: unknown, host: ArgumentsHost): void {
    const http = host.switchToHttp();
    const request = http.getRequest<Request>();
    const response = http.getResponse<Response>();
    const body = this.toBody(exception);
    body.correlationId = request.correlationId;

    if (body.statusCode >= 500) {
      this.logger.error({ err: exception, correlationId: request.correlationId }, `Unhandled error on ${request.method} ${request.path}: ${describe(exception)}`);
      void this.support?.captureServerFault({
        method: request.method,
        path: request.path,
        status: body.statusCode,
        errorName: exception instanceof Error ? exception.name : "Error",
        message: exception instanceof Error ? exception.message : String(exception),
        correlationId: request.correlationId && UUID.test(request.correlationId) ? request.correlationId : null,
        userId: request.principal?.userId ?? null,
        countryCode: request.principal?.countryCode ?? null,
        userAgent: request.get("user-agent") ?? null,
      });
    }
    response.status(body.statusCode).json(body);
  }

  private toBody(exception: unknown): ApiErrorBody {
    if (exception instanceof AppException) {
      return { statusCode: exception.getStatus(), code: exception.code, message: exception.message, fieldErrors: exception.fieldErrors };
    }
    if (exception instanceof ThrottlerException) {
      return { statusCode: HttpStatus.TOO_MANY_REQUESTS, code: ERROR_CODES.rateLimited, message: "Too many requests. Wait a moment and try again." };
    }
    const parserError = bodyParserStatus(exception);
    if (parserError) {
      return parserError;
    }
    if (exception instanceof HttpException) {
      const statusCode = exception.getStatus();
      return { statusCode, code: STATUS_CODES[statusCode] ?? ERROR_CODES.validationFailed, message: statusCode < 500 ? exception.message : "Something went wrong." };
    }
    return { statusCode: HttpStatus.INTERNAL_SERVER_ERROR, code: ERROR_CODES.internal, message: "Something went wrong." };
  }
}

function bodyParserStatus(exception: unknown): ApiErrorBody | null {
  const type = (exception as { type?: unknown } | null)?.type;
  if (type === "entity.too.large") {
    return { statusCode: HttpStatus.PAYLOAD_TOO_LARGE, code: ERROR_CODES.validationFailed, message: "The request is too large." };
  }
  if (type === "entity.parse.failed" || type === "encoding.unsupported" || type === "charset.unsupported") {
    return { statusCode: HttpStatus.BAD_REQUEST, code: ERROR_CODES.validationFailed, message: "The request body could not be read." };
  }
  return null;
}

function describe(exception: unknown): string {
  return exception instanceof Error ? `${exception.name}: ${exception.message}`.slice(0, 500) : String(exception).slice(0, 500);
}
