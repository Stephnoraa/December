/**
 * Demo data: "Demo Lounge, Wuse 2, Abuja". Run with `pnpm db:seed` (idempotent: it skips
 * when the demo venue already exists; use `pnpm db:reset` to start over).
 * Dev logins are listed in docs/RUNBOOK.md. Never run this against production.
 */
import { hash } from 'argon2';
import { randomBytes } from 'node:crypto';
import { PrismaClient } from '@prisma/client';

export const DEMO = {
  venueSlug: 'demo-lounge',
  owner: { email: 'owner@demo.test', password: 'demo-owner-pass', pin: '1111', name: 'Ada Okafor' },
  manager: {
    email: 'manager@demo.test',
    password: 'demo-manager-pass',
    pin: '2222',
    name: 'Musa Bello',
  },
  waiter: { pin: '3333', name: 'Chidi Waiter' },
  station: { pin: '4444', name: 'Kitchen & Bar Screen' },
  admin: { email: 'admin@platform.test', password: 'platform-admin-pass', name: 'Platform Admin' },
  /** Placeholder sub-account so online payments work with the mock provider in dev. */
  mockSubaccountCode: 'ACCT_demo_mock',
} as const;

const naira = (n: number) => n * 100;

interface SeedItem {
  name: string;
  description?: string;
  price: number;
  station: 'Kitchen' | 'Bar';
  addOns?: { name: string; price: number }[];
}

const EXTRA_PLANTAIN = { name: 'Extra plantain', price: 500 };
const EXTRA_PEPPER = { name: 'Extra pepper', price: 0 };
const WITH_ICE = { name: 'With ice', price: 0 };

const MENU: { category: string; items: SeedItem[] }[] = [
  {
    category: 'Rice & Mains',
    items: [
      {
        name: 'Jollof Rice',
        description: 'Smoky party jollof with fried plantain and coleslaw.',
        price: 3500,
        station: 'Kitchen',
        addOns: [EXTRA_PLANTAIN, EXTRA_PEPPER, { name: 'Add grilled chicken', price: 2500 }],
      },
      {
        name: 'Fried Rice',
        description: 'Nigerian fried rice with mixed vegetables and liver.',
        price: 3500,
        station: 'Kitchen',
        addOns: [EXTRA_PLANTAIN, { name: 'Add grilled chicken', price: 2500 }],
      },
      {
        name: 'Peppered Goat Meat',
        description: 'Tender goat meat tossed in spicy pepper sauce.',
        price: 4500,
        station: 'Kitchen',
        addOns: [EXTRA_PEPPER],
      },
    ],
  },
  {
    category: 'Soups',
    items: [
      {
        name: 'Catfish Pepper Soup',
        description: 'Fresh catfish in a hot, aromatic broth.',
        price: 6000,
        station: 'Kitchen',
        addOns: [EXTRA_PEPPER],
      },
    ],
  },
  {
    category: 'Grills & Small Chops',
    items: [
      {
        name: 'Beef Suya',
        description: 'Spicy grilled beef skewers with onions and yaji.',
        price: 3000,
        station: 'Kitchen',
        addOns: [EXTRA_PEPPER],
      },
      {
        name: 'Small Chops Platter',
        description: 'Puff-puff, samosa, spring rolls and peppered gizzard.',
        price: 5000,
        station: 'Kitchen',
      },
      { name: 'Fried Plantain (Dodo)', price: 1500, station: 'Kitchen', addOns: [EXTRA_PEPPER] },
    ],
  },
  {
    category: 'Drinks',
    items: [
      {
        name: 'Chapman',
        description: 'House Chapman, cucumber and citrus.',
        price: 2500,
        station: 'Bar',
        addOns: [WITH_ICE],
      },
      {
        name: 'Zobo',
        description: 'Chilled hibiscus drink.',
        price: 1500,
        station: 'Bar',
        addOns: [WITH_ICE],
      },
      { name: 'Bottled Water (75cl)', price: 500, station: 'Bar' },
      { name: 'Lager (bottle)', price: 1500, station: 'Bar' },
    ],
  },
  {
    category: 'Spirits (per shot)',
    items: [
      { name: 'Hennessy VS (shot)', price: 4000, station: 'Bar', addOns: [WITH_ICE] },
      {
        name: 'Jameson (shot)',
        price: 3000,
        station: 'Bar',
        addOns: [WITH_ICE, { name: 'Add mixer', price: 500 }],
      },
      {
        name: 'Smirnoff Vodka (shot)',
        price: 2000,
        station: 'Bar',
        addOns: [WITH_ICE, { name: 'Add mixer', price: 500 }],
      },
    ],
  },
];

const TABLES: { area: string; labels: string[] }[] = [
  { area: 'Main Hall', labels: ['M1', 'M2', 'M3', 'M4', 'M5', 'M6'] },
  { area: 'Terrace', labels: ['T1', 'T2', 'T3', 'T4'] },
  { area: 'VIP', labels: ['VIP1', 'VIP2'] },
];

export async function seed(prisma: PrismaClient): Promise<{ venueId: string; created: boolean }> {
  const existing = await prisma.venue.findUnique({ where: { slug: DEMO.venueSlug } });
  if (existing) return { venueId: existing.id, created: false };

  const [ownerPw, managerPw, adminPw, ownerPin, managerPin, waiterPin, stationPin] =
    await Promise.all([
      hash(DEMO.owner.password),
      hash(DEMO.manager.password),
      hash(DEMO.admin.password),
      hash(DEMO.owner.pin),
      hash(DEMO.manager.pin),
      hash(DEMO.waiter.pin),
      hash(DEMO.station.pin),
    ]);

  return prisma.$transaction(async (tx) => {
    const org = await tx.organization.create({ data: { name: 'Demo Lounge Ltd' } });
    const venue = await tx.venue.create({
      data: {
        organizationId: org.id,
        name: 'Demo Lounge',
        slug: DEMO.venueSlug,
        address: 'Wuse 2, Abuja',
        paymentMode: 'POSTPAY',
        vatBps: 750,
        serviceChargeBps: 0,
        pricesIncludeVat: true,
        paystackSubaccountCode: DEMO.mockSubaccountCode,
        payoutBankCode: '058',
        payoutBankName: 'Guaranty Trust Bank',
        payoutAccountNumber: '0000000000',
        payoutAccountName: 'DEMO LOUNGE LTD (MOCK)',
        payoutConfiguredAt: new Date(),
      },
    });
    const venueId = venue.id;

    const kitchen = await tx.station.create({ data: { venueId, name: 'Kitchen', sortOrder: 0 } });
    const bar = await tx.station.create({ data: { venueId, name: 'Bar', sortOrder: 1 } });
    const stationId = { Kitchen: kitchen.id, Bar: bar.id };

    for (const group of TABLES) {
      for (const label of group.labels) {
        await tx.table.create({ data: { venueId, label, area: group.area } });
      }
    }

    let categoryOrder = 0;
    for (const section of MENU) {
      const category = await tx.menuCategory.create({
        data: { venueId, name: section.category, sortOrder: categoryOrder++ },
      });
      let itemOrder = 0;
      for (const item of section.items) {
        await tx.menuItem.create({
          data: {
            venueId,
            categoryId: category.id,
            stationId: stationId[item.station],
            name: item.name,
            description: item.description ?? null,
            priceKobo: naira(item.price),
            sortOrder: itemOrder++,
            addOns: {
              create: (item.addOns ?? []).map((a, i) => ({
                venueId,
                name: a.name,
                priceDeltaKobo: naira(a.price),
                sortOrder: i,
              })),
            },
          },
        });
      }
    }

    const staff = [
      { ...DEMO.owner, role: 'OWNER' as const, passwordHash: ownerPw, pinHash: ownerPin },
      { ...DEMO.manager, role: 'MANAGER' as const, passwordHash: managerPw, pinHash: managerPin },
      { name: DEMO.waiter.name, role: 'WAITER' as const, pinHash: waiterPin },
      { name: DEMO.station.name, role: 'STATION' as const, pinHash: stationPin },
    ];
    for (const s of staff) {
      await tx.staffMember.create({
        data: {
          organizationId: org.id,
          venueId,
          name: s.name,
          role: s.role,
          email: 'email' in s ? s.email : null,
          passwordHash: 'passwordHash' in s ? s.passwordHash : null,
          pinHash: s.pinHash,
        },
      });
    }

    await tx.platformAdmin.upsert({
      where: { email: DEMO.admin.email },
      update: {},
      create: { email: DEMO.admin.email, name: DEMO.admin.name, passwordHash: adminPw },
    });

    await tx.auditEvent.create({
      data: {
        venueId,
        actorType: 'SYSTEM',
        action: 'VENUE_CREATED',
        entityType: 'Venue',
        entityId: venueId,
        after: { name: venue.name, seed: true, nonce: randomBytes(4).toString('hex') },
      },
    });

    return { venueId, created: true };
  });
}

if (require.main === module) {
  if (process.env.NODE_ENV === 'production' && process.env.ALLOW_PRODUCTION_SEED !== 'true') {
    console.error('Refusing to seed demo data with NODE_ENV=production');
    process.exit(1);
  }
  const prisma = new PrismaClient();
  seed(prisma)
    .then((r) => {
      console.info(
        r.created ? `Seeded demo venue ${r.venueId}` : 'Demo venue already exists, nothing to do',
      );
    })
    .catch((err: unknown) => {
      console.error(err);
      process.exitCode = 1;
    })
    .finally(() => void prisma.$disconnect());
}
