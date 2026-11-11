import {
  CallHandler,
  ExecutionContext,
  HttpStatus,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import { createHash } from 'node:crypto';
import type { Response } from 'express';
import { from, mergeMap, of, catchError, throwError, type Observable } from 'rxjs';
import { Prisma, type DbClient } from '@app/db';
import { ErrorCode } from '@app/shared';
import { InjectDb } from './db';
import { AppError } from './errors';
import type { AppRequest } from './request';

const MUTATING = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);
const TTL_MS = 24 * 60 * 60 * 1000;
const KEY_PATTERN = /^[A-Za-z0-9_-]{8,100}$/;

function actorScope(req: AppRequest): string {
  if (req.staff) return `staff:${req.staff.sessionId}`;
  if (req.customer) return `customer:${req.customer.customerSessionId}`;
  if (req.admin) return `admin:${req.admin.adminId}`;
  return `anon:${req.ip ?? 'unknown'}`;
}

/**
 * Idempotency-Key support for every mutating endpoint.
 * First request with a key: runs normally and stores the response for 24h.
 * Same key + same body again: replays the stored response (header Idempotent-Replayed: true).
 * Same key + different body: 422. Same key while the first is still running: 409.
 * Failed requests (errors) release the key so the client can retry.
 */
@Injectable()
export class IdempotencyInterceptor implements NestInterceptor {
  constructor(@InjectDb() private readonly db: DbClient) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (context.getType() !== 'http') return next.handle();
    const req = context.switchToHttp().getRequest<AppRequest>();
    const res = context.switchToHttp().getResponse<Response>();
    const key = req.header('idempotency-key');
    if (!key || !MUTATING.has(req.method)) return next.handle();
    if (!KEY_PATTERN.test(key)) {
      return throwError(
        () =>
          new AppError(
            ErrorCode.VALIDATION_FAILED,
            'Idempotency-Key must be 8-100 URL-safe characters',
          ),
      );
    }
    const routePath = (req.route as { path?: string } | undefined)?.path ?? req.path;
    const scope = `${actorScope(req)}:${req.method}:${routePath}`;
    const requestHash = createHash('sha256')
      .update(JSON.stringify({ params: req.params, body: req.body ?? null }))
      .digest('hex');

    return from(this.claim(scope, key, requestHash)).pipe(
      mergeMap((claim) => {
        if (claim.kind === 'replay') {
          res.status(claim.status);
          res.setHeader('Idempotent-Replayed', 'true');
          return of(claim.body);
        }
        return next.handle().pipe(
          mergeMap((body: unknown) =>
            from(this.complete(claim.id, res.statusCode || HttpStatus.OK, body)).pipe(
              mergeMap(() => of(body)),
            ),
          ),
          catchError((err: unknown) =>
            from(this.release(claim.id)).pipe(mergeMap(() => throwError(() => err))),
          ),
        );
      }),
    );
  }

  private async claim(
    scope: string,
    key: string,
    requestHash: string,
  ): Promise<{ kind: 'new'; id: string } | { kind: 'replay'; status: number; body: unknown }> {
    try {
      const rec = await this.db.idempotencyRecord.create({
        data: { scope, key, requestHash, expiresAt: new Date(Date.now() + TTL_MS) },
      });
      return { kind: 'new', id: rec.id };
    } catch (err) {
      if (!(err instanceof Prisma.PrismaClientKnownRequestError) || err.code !== 'P2002') throw err;
    }
    const existing = await this.db.idempotencyRecord.findUnique({
      where: { scope_key: { scope, key } },
    });
    if (!existing) return this.claim(scope, key, requestHash);
    if (existing.expiresAt < new Date()) {
      await this.db.idempotencyRecord.delete({ where: { id: existing.id } }).catch(() => undefined);
      return this.claim(scope, key, requestHash);
    }
    if (existing.requestHash !== requestHash) {
      throw new AppError(
        ErrorCode.IDEMPOTENCY_KEY_REUSED,
        'This Idempotency-Key was already used for a different request',
        HttpStatus.UNPROCESSABLE_ENTITY,
      );
    }
    if (existing.status !== 'COMPLETED') {
      throw AppError.conflict(
        ErrorCode.IDEMPOTENCY_IN_PROGRESS,
        'The original request is still being processed',
      );
    }
    return { kind: 'replay', status: existing.responseStatus ?? 200, body: existing.responseBody };
  }

  private async complete(id: string, status: number, body: unknown): Promise<void> {
    await this.db.idempotencyRecord.update({
      where: { id },
      data: {
        status: 'COMPLETED',
        responseStatus: status,
        responseBody: body === undefined ? Prisma.JsonNull : (body as Prisma.InputJsonValue),
      },
    });
  }

  private async release(id: string): Promise<void> {
    await this.db.idempotencyRecord.delete({ where: { id } }).catch(() => undefined);
  }
}
