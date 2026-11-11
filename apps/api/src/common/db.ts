import { Inject } from '@nestjs/common';

/** Injection token for the tenancy-aware Prisma client (DbClient from @app/db). */
export const DB = Symbol('DB');
export const InjectDb = () => Inject(DB);
