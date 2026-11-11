import type { ExecutionContext } from '@nestjs/common';
import type { Request } from 'express';

/** Per-app rate limits, stored on the Express app so tests can run several apps side by side. */
export interface RateLimits {
  /** Sign-up, password and PIN login, per IP per minute. */
  auth: number;
  /** Public customer endpoints (menu, join, order, call waiter), per IP per minute. */
  public: number;
}

export const RATE_LIMITS_KEY = 'rateLimits';

function limits(ctx: ExecutionContext): RateLimits {
  const req = ctx.switchToHttp().getRequest<Request>();
  return (req.app.locals[RATE_LIMITS_KEY] as RateLimits | undefined) ?? { auth: 10, public: 120 };
}

const MINUTE = 60_000;

/** Use with @Throttle(AUTH_THROTTLE). */
export const AUTH_THROTTLE = {
  default: { ttl: MINUTE, limit: (ctx: ExecutionContext) => limits(ctx).auth },
};
export const PUBLIC_THROTTLE = {
  default: { ttl: MINUTE, limit: (ctx: ExecutionContext) => limits(ctx).public },
};
