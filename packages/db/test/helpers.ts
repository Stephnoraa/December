import { inject } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { createTestDatabase } from '../src/testing';
import { createPrismaClient } from '../src/client';

export async function freshDatabase() {
  const db = await createTestDatabase(inject('pgAdminUrl'), inject('pgTemplateDb'));
  const raw = new PrismaClient({ datasourceUrl: db.url, log: ['error'] });
  const scoped = createPrismaClient({ url: db.url, log: ['error'] });
  return {
    url: db.url,
    raw,
    scoped,
    async close() {
      await raw.$disconnect();
      await scoped.$disconnect();
      await db.drop();
    },
  };
}
