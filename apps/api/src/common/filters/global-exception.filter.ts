import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common'
import { ZodValidationException } from 'nestjs-zod'
import type { ZodError, ZodIssue } from 'zod'
import type { Request, Response } from 'express'

interface ErrorBody {
  error: {
    code: string
    message: string
    details?: unknown
  }
}

const HTTP_STATUS_CODES: Record<number, string> = {
  400: 'BAD_REQUEST',
  401: 'UNAUTHORIZED',
  403: 'FORBIDDEN',
  404: 'NOT_FOUND',
  409: 'CONFLICT',
  411: 'LENGTH_REQUIRED',
  413: 'PAYLOAD_TOO_LARGE',
  415: 'UNSUPPORTED_MEDIA_TYPE',
  422: 'UNPROCESSABLE_ENTITY',
  429: 'TOO_MANY_REQUESTS',
  503: 'SERVICE_UNAVAILABLE',
  507: 'INSUFFICIENT_STORAGE',
}

@Catch()
export class GlobalExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(GlobalExceptionFilter.name)

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp()
    const response = ctx.getResponse<Response>()
    const request = ctx.getRequest<Request>()

    if (exception instanceof ZodValidationException) {
      const zodError = exception.getZodError() as ZodError
      response.status(400).json({
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Invalid request body.',
          details: zodError.issues.map((issue: ZodIssue) => ({
            path: issue.path,
            message: issue.message,
          })),
        },
      } satisfies ErrorBody)
      return
    }

    if (exception instanceof HttpException) {
      const status = exception.getStatus()
      const res = exception.getResponse()
      const body =
        typeof res === 'string'
          ? { message: res }
          : (res as { message?: string; details?: unknown })
      response.status(status).json({
        error: {
          code: HTTP_STATUS_CODES[status] ?? `HTTP_${status}`,
          message: body.message ?? exception.message,
          // Field-level details (e.g. invalid answers) are passed through when an exception carries them.
          ...(body.details !== undefined ? { details: body.details } : {}),
        },
      } satisfies ErrorBody)
      return
    }

    this.logger.error(
      `Unhandled exception on ${request.method} ${request.url}`,
      exception instanceof Error ? exception.stack : String(exception),
    )
    response.status(HttpStatus.INTERNAL_SERVER_ERROR).json({
      error: {
        code: 'INTERNAL_ERROR',
        message: 'An unexpected error occurred.',
      },
    } satisfies ErrorBody)
  }
}
