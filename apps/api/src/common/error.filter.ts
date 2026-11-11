import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { ThrottlerException } from '@nestjs/throttler';
import type { Response } from 'express';
import { ZodError } from 'zod';
import { Prisma, TenancyError } from '@app/db';
import { ErrorCode, InvalidTransitionError, MoneyError, type ApiErrorBody } from '@app/shared';
import { AppError } from './errors';

const STATUS_CODES: Record<number, ErrorCode> = {
  400: ErrorCode.VALIDATION_FAILED,
  401: ErrorCode.UNAUTHENTICATED,
  403: ErrorCode.FORBIDDEN,
  404: ErrorCode.NOT_FOUND,
  409: ErrorCode.CONFLICT,
  429: ErrorCode.RATE_LIMITED,
};

export function toErrorResponse(err: unknown): {
  status: number;
  body: ApiErrorBody;
  log: boolean;
} {
  const make = (status: number, code: string, message: string, details?: unknown, log = false) => ({
    status,
    body: { error: details === undefined ? { code, message } : { code, message, details } },
    log,
  });
  if (err instanceof AppError) return make(err.status, err.code, err.message, err.details);
  if (err instanceof ZodError) {
    return make(400, ErrorCode.VALIDATION_FAILED, 'Some fields are invalid', {
      issues: err.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
    });
  }
  if (err instanceof ThrottlerException) {
    return make(
      429,
      ErrorCode.RATE_LIMITED,
      'Too many requests. Please wait a moment and try again.',
    );
  }
  if (err instanceof InvalidTransitionError)
    return make(409, ErrorCode.INVALID_TRANSITION, err.message);
  if (err instanceof MoneyError) return make(400, ErrorCode.VALIDATION_FAILED, err.message);
  if (err instanceof TenancyError)
    return make(403, ErrorCode.FORBIDDEN, 'Not allowed for this venue', undefined, true);
  if (err instanceof Prisma.PrismaClientKnownRequestError) {
    if (err.code === 'P2002') return make(409, ErrorCode.CONFLICT, 'That already exists');
    if (err.code === 'P2025') return make(404, ErrorCode.NOT_FOUND, 'Resource not found');
  }
  if (err instanceof HttpException) {
    const status = err.getStatus();
    const res = err.getResponse();
    const message =
      typeof res === 'string'
        ? res
        : typeof (res as { message?: unknown }).message === 'string'
          ? (res as { message: string }).message
          : err.message;
    return make(
      status,
      STATUS_CODES[status] ?? (status >= 500 ? ErrorCode.INTERNAL : 'HTTP_ERROR'),
      message,
    );
  }
  return make(
    HttpStatus.INTERNAL_SERVER_ERROR,
    ErrorCode.INTERNAL,
    'Something went wrong',
    undefined,
    true,
  );
}

@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger('Errors');

  catch(exception: unknown, host: ArgumentsHost): void {
    if (host.getType() !== 'http') return;
    const res = host.switchToHttp().getResponse<Response>();
    const { status, body, log } = toErrorResponse(exception);
    if (log || status >= 500) this.logger.error(exception);
    if (res.headersSent) return;
    res.status(status).json(body);
  }
}
