import type { NextFunction, Request, Response } from 'express';
import { tenancy } from '@app/db';

/**
 * Opens an empty tenant context for every HTTP request. Guards bind it to a venue once the
 * caller is known; until then tenant tables cannot be queried.
 */
export function tenantContextMiddleware(_req: Request, _res: Response, next: NextFunction): void {
  tenancy.run(() => next());
}
