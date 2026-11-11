import { AsyncLocalStorage } from 'node:async_hooks';
import { Prisma } from '@prisma/client';

/**
 * Tenant scoping.
 *
 * Every request (and every background task) runs inside a TenantContext held in
 * AsyncLocalStorage. The Prisma extension below reads it and:
 *  - adds `venueId = <current venue>` to every read/update/delete on tenant-owned models;
 *  - sets or checks `venueId` on every create;
 *  - throws when there is no context at all, so unscoped queries cannot slip through.
 * Code that legitimately works across venues (signup, webhooks before the venue is known,
 * the platform admin, the scheduler) must opt in explicitly with `runAsSystem`.
 *
 * Limits (documented in docs/ARCHITECTURE.md): nested writes and $queryRaw are not rewritten.
 * Nested creates must set venueId explicitly; raw SQL must filter on "venueId" itself.
 */

export interface TenantContext {
  venueId?: string;
  system?: boolean;
}

const storage = new AsyncLocalStorage<TenantContext>();

export class TenancyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TenancyError';
  }
}

function isThenable(value: unknown): value is PromiseLike<unknown> {
  return (
    value !== null &&
    (typeof value === 'object' || typeof value === 'function') &&
    typeof (value as { then?: unknown }).then === 'function'
  );
}

/**
 * Runs fn inside ctx. Prisma queries are lazy (they run when awaited), so a returned
 * PrismaPromise is awaited *inside* the context; otherwise it would execute unscoped.
 */
function runIn<T>(ctx: TenantContext, fn: () => T): T {
  return storage.run(ctx, () => {
    const result = fn();
    if (isThenable(result)) {
      return (async () => await result)() as T;
    }
    return result;
  });
}

export const tenancy = {
  /** Runs fn with a fresh, empty context (the request middleware uses this). */
  run<T>(fn: () => T): T {
    return runIn({}, fn);
  },
  runForVenue<T>(venueId: string, fn: () => T): T {
    return runIn({ venueId }, fn);
  },
  runAsSystem<T>(fn: () => T): T {
    return runIn({ system: true }, fn);
  },
  current(): TenantContext | undefined {
    return storage.getStore();
  },
  currentVenueId(): string {
    const venueId = storage.getStore()?.venueId;
    if (!venueId) throw new TenancyError('No venue in the current tenant context');
    return venueId;
  },
  /**
   * Binds the current request context to a venue once the caller is authenticated.
   * A context can only ever be bound to one venue.
   */
  bindVenue(venueId: string): void {
    const store = storage.getStore();
    if (!store) throw new TenancyError('bindVenue called outside a tenant context');
    if (store.venueId && store.venueId !== venueId) {
      throw new TenancyError('Tenant context is already bound to a different venue');
    }
    store.venueId = venueId;
  },
};

/** Models that carry a venueId column and must always be scoped. */
export const TENANT_MODELS: ReadonlySet<string> = new Set([
  'Station',
  'Table',
  'MenuCategory',
  'MenuItem',
  'MenuAddOn',
  'StaffMember',
  'Device',
  'StaffSession',
  'TableSession',
  'CustomerSession',
  'Tab',
  'Order',
  'OrderItem',
  'Adjustment',
  'Payment',
  'ServiceRequest',
  'AuditEvent',
]);

const WHERE_OPERATIONS = new Set([
  'findUnique',
  'findUniqueOrThrow',
  'findFirst',
  'findFirstOrThrow',
  'findMany',
  'count',
  'aggregate',
  'groupBy',
  'update',
  'updateMany',
  'updateManyAndReturn',
  'delete',
  'deleteMany',
]);

type Args = Record<string, unknown>;

function scopeData(model: string, data: unknown, venueId: string): unknown {
  if (data === undefined || data === null || typeof data !== 'object') return data;
  const row = data as Record<string, unknown>;
  if ('venue' in row) {
    throw new TenancyError(`${model}: set venueId as a scalar, not through the venue relation`);
  }
  if (row.venueId !== undefined && row.venueId !== venueId) {
    throw new TenancyError(`${model}: cannot write a row for another venue`);
  }
  return { ...row, venueId };
}

function addWhere(where: unknown, field: string, value: string): Args {
  const base = (where as Args | undefined) ?? {};
  if (field === 'venueId') return { ...base, venueId: value };
  // For Venue the scope is the primary key: AND it in so a lookup for another venue's id
  // matches nothing instead of being rewritten to the current venue.
  const and = base.AND === undefined ? [] : Array.isArray(base.AND) ? base.AND : [base.AND];
  return { ...base, AND: [...and, { [field]: value }] };
}

export function scopeArgs(model: string, operation: string, args: Args, venueId: string): Args {
  if (model === 'Venue') {
    if (WHERE_OPERATIONS.has(operation))
      return { ...args, where: addWhere(args.where, 'id', venueId) };
    if (operation === 'upsert') return { ...args, where: addWhere(args.where, 'id', venueId) };
    throw new TenancyError(`Venue.${operation} is only allowed in system context`);
  }
  if (!TENANT_MODELS.has(model)) return args;

  if (WHERE_OPERATIONS.has(operation)) {
    const next: Args = { ...args, where: addWhere(args.where, 'venueId', venueId) };
    if (
      operation === 'updateMany' ||
      operation === 'updateManyAndReturn' ||
      operation === 'update'
    ) {
      const data = args.data as Args | undefined;
      if (data && data.venueId !== undefined && data.venueId !== venueId) {
        throw new TenancyError(`${model}: cannot move a row to another venue`);
      }
    }
    return next;
  }
  if (operation === 'create') return { ...args, data: scopeData(model, args.data, venueId) };
  if (operation === 'createMany' || operation === 'createManyAndReturn') {
    const data = Array.isArray(args.data) ? args.data : [args.data];
    return { ...args, data: data.map((d) => scopeData(model, d, venueId)) };
  }
  if (operation === 'upsert') {
    return {
      ...args,
      where: addWhere(args.where, 'venueId', venueId),
      create: scopeData(model, args.create, venueId),
    };
  }
  throw new TenancyError(`${model}.${operation} is not supported by the tenancy extension`);
}

export const tenancyExtension = Prisma.defineExtension({
  name: 'tenancy',
  query: {
    $allModels: {
      async $allOperations({ model, operation, args, query }) {
        const ctx = storage.getStore();
        if (!ctx) {
          throw new TenancyError(`${model}.${operation} called outside a tenant context`);
        }
        if (ctx.system) return query(args);
        if (!ctx.venueId) {
          if (model === 'Venue' || TENANT_MODELS.has(model)) {
            throw new TenancyError(`${model}.${operation} called before the venue is known`);
          }
          return query(args);
        }
        return query(scopeArgs(model, operation, (args ?? {}) as Args, ctx.venueId) as typeof args);
      },
    },
  },
});
