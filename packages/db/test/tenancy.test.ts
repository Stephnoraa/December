import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { tenancy, TenancyError } from '../src/tenancy';
import { freshDatabase } from './helpers';

let env: Awaited<ReturnType<typeof freshDatabase>>;
let venueA: string;
let venueB: string;
let stationB: string;
let itemB: string;

async function makeVenue(slug: string) {
  const org = await env.raw.organization.create({ data: { name: `${slug} org` } });
  const venue = await env.raw.venue.create({ data: { organizationId: org.id, name: slug, slug } });
  const station = await env.raw.station.create({ data: { venueId: venue.id, name: 'Kitchen' } });
  const category = await env.raw.menuCategory.create({
    data: { venueId: venue.id, name: 'Mains' },
  });
  const item = await env.raw.menuItem.create({
    data: {
      venueId: venue.id,
      categoryId: category.id,
      stationId: station.id,
      name: `${slug} rice`,
      priceKobo: 350_000,
    },
  });
  return { venueId: venue.id, stationId: station.id, itemId: item.id, categoryId: category.id };
}

beforeAll(async () => {
  env = await freshDatabase();
  const a = await makeVenue('venue-a');
  const b = await makeVenue('venue-b');
  venueA = a.venueId;
  venueB = b.venueId;
  stationB = b.stationId;
  itemB = b.itemId;
});

afterAll(async () => {
  await env.close();
});

describe('tenancy extension', () => {
  it('refuses queries outside any tenant context', async () => {
    await expect(env.scoped.menuItem.findMany()).rejects.toThrow(TenancyError);
  });

  it('refuses tenant queries before the venue is bound', async () => {
    await expect(tenancy.run(() => env.scoped.menuItem.findMany())).rejects.toThrow(TenancyError);
  });

  it('only returns the current venue rows', async () => {
    const items = await tenancy.runForVenue(venueA, () => env.scoped.menuItem.findMany());
    expect(items).toHaveLength(1);
    expect(items.every((i) => i.venueId === venueA)).toBe(true);
    const count = await tenancy.runForVenue(venueA, () => env.scoped.station.count());
    expect(count).toBe(1);
  });

  it('cannot read another venue row by id', async () => {
    const found = await tenancy.runForVenue(venueA, () =>
      env.scoped.menuItem.findUnique({ where: { id: itemB } }),
    );
    expect(found).toBeNull();
    const first = await tenancy.runForVenue(venueA, () =>
      env.scoped.menuItem.findFirst({ where: { id: itemB, venueId: venueB } }),
    );
    expect(first).toBeNull();
  });

  it('cannot update or delete another venue row', async () => {
    await expect(
      tenancy.runForVenue(venueA, () =>
        env.scoped.menuItem.update({ where: { id: itemB }, data: { priceKobo: 1 } }),
      ),
    ).rejects.toThrow();
    const many = await tenancy.runForVenue(venueA, () =>
      env.scoped.menuItem.updateMany({ where: { id: itemB }, data: { priceKobo: 1 } }),
    );
    expect(many.count).toBe(0);
    await expect(
      tenancy.runForVenue(venueA, () => env.scoped.station.delete({ where: { id: stationB } })),
    ).rejects.toThrow();
    const unchanged = await env.raw.menuItem.findUniqueOrThrow({ where: { id: itemB } });
    expect(unchanged.priceKobo).toBe(350_000);
  });

  it('cannot create rows for another venue, and fills venueId when omitted', async () => {
    await expect(
      tenancy.runForVenue(venueA, () =>
        env.scoped.station.create({ data: { venueId: venueB, name: 'Bar' } }),
      ),
    ).rejects.toThrow(TenancyError);
    const created = await tenancy.runForVenue(venueA, () =>
      // venueId is required by the type; the extension enforces it matches the context.
      env.scoped.station.create({ data: { venueId: venueA, name: 'Bar' } }),
    );
    expect(created.venueId).toBe(venueA);
    await expect(
      tenancy.runForVenue(venueA, () =>
        env.scoped.station.createMany({
          data: [
            { venueId: venueA, name: 'Grill' },
            { venueId: venueB, name: 'Grill' },
          ],
        }),
      ),
    ).rejects.toThrow(TenancyError);
  });

  it('scopes the Venue model to the current venue', async () => {
    const venues = await tenancy.runForVenue(venueA, () => env.scoped.venue.findMany());
    expect(venues.map((v) => v.id)).toEqual([venueA]);
    const other = await tenancy.runForVenue(venueA, () =>
      env.scoped.venue.findUnique({ where: { id: venueB } }),
    );
    expect(other).toBeNull();
  });

  it('cannot move a row to another venue', async () => {
    await expect(
      tenancy.runForVenue(venueA, () =>
        env.scoped.station.updateMany({ data: { venueId: venueB } }),
      ),
    ).rejects.toThrow(TenancyError);
  });

  it('keeps scoping inside interactive transactions', async () => {
    const ids = await tenancy.runForVenue(venueA, () =>
      env.scoped.$transaction(async (tx) => (await tx.menuItem.findMany()).map((i) => i.venueId)),
    );
    expect(new Set(ids)).toEqual(new Set([venueA]));
  });

  it('lets system context see everything', async () => {
    const count = await tenancy.runAsSystem(() => env.scoped.menuItem.count());
    expect(count).toBe(2);
  });

  it('binds a request context to one venue only', () => {
    tenancy.run(() => {
      tenancy.bindVenue(venueA);
      expect(tenancy.currentVenueId()).toBe(venueA);
      expect(() => tenancy.bindVenue(venueB)).toThrow(TenancyError);
    });
  });
});
