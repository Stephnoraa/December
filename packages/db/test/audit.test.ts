import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { freshDatabase } from './helpers';

let env: Awaited<ReturnType<typeof freshDatabase>>;
let eventId: string;
let venueId: string;

beforeAll(async () => {
  env = await freshDatabase();
  const org = await env.raw.organization.create({ data: { name: 'Org' } });
  const venue = await env.raw.venue.create({
    data: { organizationId: org.id, name: 'V', slug: 'v' },
  });
  venueId = venue.id;
  const event = await env.raw.auditEvent.create({
    data: { venueId, actorType: 'SYSTEM', action: 'TEST', entityType: 'Venue', entityId: venueId },
  });
  eventId = event.id;
});

afterAll(async () => {
  await env.close();
});

describe('audit log immutability (database triggers)', () => {
  it('allows inserts', async () => {
    await expect(
      env.raw.auditEvent.create({
        data: { venueId, actorType: 'SYSTEM', action: 'TEST2', entityType: 'Venue' },
      }),
    ).resolves.toBeTruthy();
  });

  it('rejects UPDATE', async () => {
    await expect(
      env.raw.auditEvent.update({ where: { id: eventId }, data: { reason: 'tamper' } }),
    ).rejects.toThrow(/append-only/);
    await expect(env.raw.$executeRawUnsafe(`UPDATE "AuditEvent" SET reason = 'x'`)).rejects.toThrow(
      /append-only/,
    );
  });

  it('rejects DELETE', async () => {
    await expect(env.raw.auditEvent.delete({ where: { id: eventId } })).rejects.toThrow(
      /append-only/,
    );
    await expect(env.raw.auditEvent.deleteMany({})).rejects.toThrow(/append-only/);
  });

  it('rejects TRUNCATE', async () => {
    await expect(env.raw.$executeRawUnsafe(`TRUNCATE "AuditEvent"`)).rejects.toThrow(/append-only/);
  });

  it('still has every row', async () => {
    expect(await env.raw.auditEvent.count()).toBe(2);
  });
});

describe('integrity constraints', () => {
  it('allows only one live session per table', async () => {
    const table = await env.raw.table.create({ data: { venueId, label: 'T1' } });
    await env.raw.tableSession.create({ data: { venueId, tableId: table.id, status: 'OPEN' } });
    await expect(
      env.raw.tableSession.create({ data: { venueId, tableId: table.id, status: 'OPEN' } }),
    ).rejects.toThrow();
    await env.raw.tableSession.updateMany({
      where: { tableId: table.id },
      data: { status: 'CLOSED' },
    });
    await expect(
      env.raw.tableSession.create({ data: { venueId, tableId: table.id, status: 'OPEN' } }),
    ).resolves.toBeTruthy();
  });

  it('rejects negative prices', async () => {
    const station = await env.raw.station.create({ data: { venueId, name: 'K' } });
    const category = await env.raw.menuCategory.create({ data: { venueId, name: 'C' } });
    await expect(
      env.raw.menuItem.create({
        data: { venueId, stationId: station.id, categoryId: category.id, name: 'x', priceKobo: -1 },
      }),
    ).rejects.toThrow();
  });
});
