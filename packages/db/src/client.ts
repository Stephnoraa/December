import { type Prisma, PrismaClient } from '@prisma/client';
import { tenancyExtension } from './tenancy';

export interface CreateClientOptions {
  url?: string;
  log?: Prisma.LogLevel[];
}

/** Creates the tenancy-aware Prisma client. Use exactly one per process. */
export function createPrismaClient(opts: CreateClientOptions = {}) {
  const base = new PrismaClient({
    datasourceUrl: opts.url,
    log: opts.log ?? ['warn'],
  });
  return base.$extends(tenancyExtension);
}

export type DbClient = ReturnType<typeof createPrismaClient>;
/** The client available inside `db.$transaction(async (tx) => ...)`. */
export type DbTx = Omit<DbClient, '$connect' | '$disconnect' | '$on' | '$transaction' | '$extends'>;

const LOCKABLE = new Set(['Tab', 'TableSession', 'Order', 'OrderItem', 'Payment']);

/**
 * SELECT ... FOR UPDATE on one tenant row inside a transaction. Raw SQL bypasses the
 * tenancy extension, so the venueId filter is applied here explicitly.
 * Returns false when the row does not exist for that venue.
 */
export async function lockRow(
  tx: DbTx,
  model: 'Tab' | 'TableSession' | 'Order' | 'OrderItem' | 'Payment',
  id: string,
  venueId: string,
): Promise<boolean> {
  if (!LOCKABLE.has(model)) throw new Error(`lockRow: ${model} is not lockable`);
  const rows = await tx.$queryRawUnsafe<{ id: string }[]>(
    `SELECT id FROM "${model}" WHERE id = $1::uuid AND "venueId" = $2::uuid FOR UPDATE`,
    id,
    venueId,
  );
  return rows.length === 1;
}

/** Transaction-scoped advisory lock (used so only one instance runs a scheduled job). */
export async function tryAdvisoryXactLock(tx: DbTx, key: number): Promise<boolean> {
  const rows = await tx.$queryRaw<
    { locked: boolean }[]
  >`SELECT pg_try_advisory_xact_lock(${key}) AS locked`;
  return rows[0]?.locked === true;
}
