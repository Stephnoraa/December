import { Client } from 'pg';
import { PrismaClient } from '@app/db';
import { migrateDatabase } from '@app/db/testing';
import { seed } from '@app/db/seed';
import { E2E } from './playwright.config';

/** Recreates, migrates and seeds the e2e database. */
export default async function globalSetup() {
  const url = new URL(E2E.databaseUrl);
  const dbName = url.pathname.slice(1);
  const admin = new URL(E2E.databaseUrl);
  admin.pathname = '/postgres';
  const client = new Client({ connectionString: admin.toString() });
  await client.connect();
  await client.query(`DROP DATABASE IF EXISTS "${dbName}" WITH (FORCE)`);
  await client.query(`CREATE DATABASE "${dbName}"`);
  await client.end();
  migrateDatabase(E2E.databaseUrl);
  const prisma = new PrismaClient({ datasourceUrl: E2E.databaseUrl });
  await seed(prisma);
  await prisma.$disconnect();
}
