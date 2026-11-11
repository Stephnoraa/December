import { HttpStatus } from '@nestjs/common';
import { ErrorCode } from '@app/shared';

/** Domain error with a stable code. Rendered as { error: { code, message, details? } }. */
export class AppError extends Error {
  constructor(
    readonly code: ErrorCode,
    message: string,
    readonly status: HttpStatus = HttpStatus.BAD_REQUEST,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = 'AppError';
  }

  static notFound(what = 'Resource'): AppError {
    return new AppError(ErrorCode.NOT_FOUND, `${what} not found`, HttpStatus.NOT_FOUND);
  }
  static forbidden(message = 'You do not have permission to do that'): AppError {
    return new AppError(ErrorCode.FORBIDDEN, message, HttpStatus.FORBIDDEN);
  }
  static unauthenticated(message = 'Please sign in'): AppError {
    return new AppError(ErrorCode.UNAUTHENTICATED, message, HttpStatus.UNAUTHORIZED);
  }
  static conflict(code: ErrorCode, message: string, details?: unknown): AppError {
    return new AppError(code, message, HttpStatus.CONFLICT, details);
  }
}
