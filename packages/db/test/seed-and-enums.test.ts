import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { $Enums } from '@prisma/client';
import * as shared from '@app/shared';
import { DEMO, seed } from '../src/seed';
import { freshDatabase } from './helpers';

let env: Awaited<ReturnType<typeof freshDatabase>>;

beforeAll(async () => {
  env = await freshDatabase();
});
afterAll(async () => {
  await env.close();
});

describe('seed', () => {
  it('creates the demo venue once', async () => {
    const first = await seed(env.raw);
    expect(first.created).toBe(true);
    const again = await seed(env.raw);
    expect(again).toEqual({ venueId: first.venueId, created: false });
    expect(await env.raw.table.count()).toBe(12);
    expect(await env.raw.station.count()).toBe(2);
    expect(await env.raw.staffMember.count()).toBe(4);
    expect(await env.raw.platformAdmin.count()).toBe(1);
    const venue = await env.raw.venue.findUniqueOrThrow({ where: { slug: DEMO.venueSlug } });
    expect(venue.address).toBe('Wuse 2, Abuja');
    const names = (await env.raw.menuItem.findMany()).map((i) => i.name);
    expect(names).toEqual(
      expect.arrayContaining(['Jollof Rice', 'Chapman', 'Zobo', 'Catfish Pepper Soup']),
    );
  });
});

describe('shared enums mirror Prisma enums', () => {
  const pairs: [string, Record<string, string>, Record<string, string>][] = [
    ['StaffRole', $Enums.StaffRole, shared.StaffRole],
    ['PaymentMode', $Enums.PaymentMode, shared.PaymentMode],
    ['VenueStatus', $Enums.VenueStatus, shared.VenueStatus],
    ['TableSessionStatus', $Enums.TableSessionStatus, shared.TableSessionStatus],
    ['TabStatus', $Enums.TabStatus, shared.TabStatus],
    ['OrderStatus', $Enums.OrderStatus, shared.OrderStatus],
    ['OrderItemStatus', $Enums.OrderItemStatus, shared.OrderItemStatus],
    ['AdjustmentType', $Enums.AdjustmentType, shared.AdjustmentType],
    ['DiscountKind', $Enums.DiscountKind, shared.DiscountKind],
    ['PaymentMethod', $Enums.PaymentMethod, shared.PaymentMethod],
    ['PaymentStatus', $Enums.PaymentStatus, shared.PaymentStatus],
    ['ServiceRequestType', $Enums.ServiceRequestType, shared.ServiceRequestType],
    ['ServiceRequestStatus', $Enums.ServiceRequestStatus, shared.ServiceRequestStatus],
  ];
  it.each(pairs)('%s', (_name, prismaEnum, sharedEnum) => {
    expect(Object.values(sharedEnum).sort()).toEqual(Object.values(prismaEnum).sort());
  });
});
