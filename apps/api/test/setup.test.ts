import sharp from 'sharp';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { QrTokenService } from '../src/qr/qr-token.service';
import {
  createTestContext,
  DEMO,
  loginManager,
  loginOwner,
  pinAgent,
  type TestContext,
} from './helpers';

let ctx: TestContext;

beforeAll(async () => {
  ctx = await createTestContext();
});
afterAll(async () => {
  await ctx?.close();
});

async function otherVenueOwner() {
  const agent = ctx.agent();
  await agent
    .post('/v1/auth/signup')
    .send({
      ownerName: 'Rival Owner',
      email: `rival-${Date.now()}@example.com`,
      password: 'super-secret-1',
      pin: '8888',
      venueName: 'Rival Bar',
    })
    .expect(201);
  return agent;
}

describe('venue settings', () => {
  it('reads and updates settings with an audit trail', async () => {
    const owner = await loginOwner(ctx);
    const before = await owner.get('/v1/admin/venue').expect(200);
    expect(before.body).toMatchObject({
      name: 'Demo Lounge',
      vatBps: 750,
      serviceChargeBps: 0,
      pricesIncludeVat: true,
    });
    expect(before.body.payout.accountNumberMasked).toBe('******0000');
    const res = await owner
      .patch('/v1/admin/venue')
      .send({ serviceChargeBps: 1000, paymentMode: 'PREPAY' })
      .expect(200);
    expect(res.body.serviceChargeBps).toBe(1000);
    expect(res.body.paymentMode).toBe('PREPAY');
    const audit = await ctx.raw.auditEvent.findFirstOrThrow({
      where: { venueId: ctx.venueId, action: 'SETTINGS_CHANGED' },
    });
    expect(audit.before).toEqual({ serviceChargeBps: 0, paymentMode: 'POSTPAY' });
    expect(audit.after).toEqual({ serviceChargeBps: 1000, paymentMode: 'PREPAY' });
    await owner
      .patch('/v1/admin/venue')
      .send({ serviceChargeBps: 0, paymentMode: 'POSTPAY' })
      .expect(200);
  });

  it('validates input and forbids waiters', async () => {
    const owner = await loginOwner(ctx);
    const bad = await owner.patch('/v1/admin/venue').send({ vatBps: 20_000 }).expect(400);
    expect(bad.body.error.code).toBe('VALIDATION_FAILED');
    const waiter = await pinAgent(ctx, 'WAITER');
    await waiter.get('/v1/admin/venue').expect(403);
    await waiter.patch('/v1/admin/venue').send({ name: 'Hacked' }).expect(403);
  });

  it('shows the setup checklist', async () => {
    const owner = await loginOwner(ctx);
    const res = await owner.get('/v1/admin/venue/checklist').expect(200);
    const byKey = Object.fromEntries(
      res.body.items.map((i: { key: string; done: boolean }) => [i.key, i.done]),
    );
    expect(byKey).toMatchObject({
      stations: true,
      tables: true,
      menu: true,
      staff: true,
      payout: true,
    });
    expect(res.body.ready).toBe(byKey.device);
  });
});

describe('stations and tables', () => {
  it('creates stations and refuses to deactivate one that still has menu items', async () => {
    const owner = await loginOwner(ctx);
    const grill = await owner.post('/v1/admin/stations').send({ name: 'Grill' }).expect(201);
    expect(grill.body.name).toBe('Grill');
    const list = await owner.get('/v1/admin/stations').expect(200);
    expect(list.body.map((s: { name: string }) => s.name)).toEqual(
      expect.arrayContaining(['Kitchen', 'Bar', 'Grill']),
    );
    const bar = list.body.find((s: { name: string }) => s.name === 'Bar');
    const res = await owner
      .patch(`/v1/admin/stations/${bar.id}`)
      .send({ active: false })
      .expect(409);
    expect(res.body.error.code).toBe('CONFLICT');
    await owner.patch(`/v1/admin/stations/${grill.body.id}`).send({ active: false }).expect(200);
  });

  it('creates tables in bulk with signed QR links, and rotation changes the link', async () => {
    const owner = await loginOwner(ctx);
    const created = await owner
      .post('/v1/admin/tables/bulk')
      .send({ prefix: 'P', from: 1, to: 3, area: 'Pool' })
      .expect(201);
    const pool = created.body.filter((t: { area: string }) => t.area === 'Pool');
    expect(pool.map((t: { label: string }) => t.label)).toEqual(['P1', 'P2', 'P3']);
    const qr = ctx.app.get(QrTokenService);
    const url = new URL(pool[0].qrUrl);
    const [, , slug, token] = url.pathname.split('/');
    expect(slug).toBe(DEMO.venueSlug);
    expect(qr.verify(token!)).toEqual({ venueId: ctx.venueId, tableId: pool[0].id, version: 1 });
    // Tampering with one character breaks the signature.
    const tampered = token!.slice(0, -2) + (token!.endsWith('A') ? 'BB' : 'AA');
    expect(qr.verify(tampered)).toBeNull();
    const rotated = await owner
      .post('/v1/admin/tables/rotate-qr')
      .send({ tableIds: [pool[0].id] })
      .expect(200);
    const after = rotated.body.find((t: { id: string }) => t.id === pool[0].id);
    expect(after.qrVersion).toBe(2);
    expect(after.qrUrl).not.toBe(pool[0].qrUrl);
    expect(
      await ctx.raw.auditEvent.count({ where: { action: 'QR_ROTATED', venueId: ctx.venueId } }),
    ).toBe(1);
  });

  it('downloads the printable QR sheet', async () => {
    const owner = await loginOwner(ctx);
    const res = await owner
      .get('/v1/admin/tables/qr.pdf')
      .buffer(true)
      .parse((r, cb) => {
        const chunks: Buffer[] = [];
        r.on('data', (c: Buffer) => chunks.push(c));
        r.on('end', () => cb(null, Buffer.concat(chunks)));
      })
      .expect(200);
    expect(res.headers['content-type']).toBe('application/pdf');
    expect((res.body as Buffer).subarray(0, 4).toString()).toBe('%PDF');
    expect((res.body as Buffer).length).toBeGreaterThan(5000);
  });
});

describe('menu', () => {
  it('creates categories, items and add-ons, and toggles availability with audit', async () => {
    const manager = await loginManager(ctx);
    const stations = await manager.get('/v1/admin/stations').expect(200);
    const kitchen = stations.body.find((s: { name: string }) => s.name === 'Kitchen');
    const cat = await manager
      .post('/v1/admin/menu/categories')
      .send({ name: 'Swallow' })
      .expect(201);
    const item = await manager
      .post('/v1/admin/menu/items')
      .send({
        categoryId: cat.body.id,
        stationId: kitchen.id,
        name: 'Pounded Yam & Egusi',
        priceKobo: 450_000,
      })
      .expect(201);
    expect(item.body.priceKobo).toBe(450_000);
    const withAddOn = await manager
      .post(`/v1/admin/menu/items/${item.body.id}/add-ons`)
      .send({ name: 'Extra meat', priceDeltaKobo: 150_000 })
      .expect(201);
    expect(withAddOn.body.addOns).toEqual([
      expect.objectContaining({ name: 'Extra meat', priceDeltaKobo: 150_000 }),
    ]);
    const off = await manager
      .patch(`/v1/admin/menu/items/${item.body.id}/availability`)
      .send({ isAvailable: false })
      .expect(200);
    expect(off.body.isAvailable).toBe(false);
    const audit = await ctx.raw.auditEvent.findFirstOrThrow({
      where: { action: 'MENU_AVAILABILITY_CHANGED', entityId: item.body.id },
    });
    expect(audit.after).toMatchObject({ isAvailable: false });
    const menu = await manager.get('/v1/admin/menu').expect(200);
    const swallow = menu.body.find((c: { id: string }) => c.id === cat.body.id);
    expect(swallow.items).toHaveLength(1);
    await manager.delete(`/v1/admin/menu/items/${item.body.id}`).expect(200);
    const menu2 = await manager.get('/v1/admin/menu').expect(200);
    expect(menu2.body.find((c: { id: string }) => c.id === cat.body.id).items).toHaveLength(0);
  });

  it('rejects negative prices and unknown stations', async () => {
    const owner = await loginOwner(ctx);
    const menu = await owner.get('/v1/admin/menu').expect(200);
    const cat = menu.body[0];
    await owner
      .post('/v1/admin/menu/items')
      .send({ categoryId: cat.id, stationId: cat.items[0].stationId, name: 'Bad', priceKobo: -5 })
      .expect(400);
    await owner
      .post('/v1/admin/menu/items')
      .send({
        categoryId: cat.id,
        stationId: '01890000-0000-7000-8000-000000000000',
        name: 'Bad',
        priceKobo: 5,
      })
      .expect(400);
  });

  it('uploads a photo and serves a small WebP', async () => {
    const owner = await loginOwner(ctx);
    const menu = await owner.get('/v1/admin/menu').expect(200);
    const item = menu.body[0].items[0];
    const png = await sharp({
      create: { width: 1600, height: 1200, channels: 3, background: '#cc5500' },
    })
      .png()
      .toBuffer();
    const up = await owner
      .post(`/v1/admin/menu/items/${item.id}/image/upload-url`)
      .send({ contentType: 'image/png', sizeBytes: png.length })
      .expect(201);
    const uploadPath = new URL(up.body.uploadUrl).pathname;
    await ctx.http().put(uploadPath).set('Content-Type', 'image/png').send(png).expect(200);
    const done = await owner
      .post(`/v1/admin/menu/items/${item.id}/image`)
      .send({ uploadKey: up.body.uploadKey })
      .expect(200);
    expect(done.body.imageUrl).toMatch(/\/media\/public\/menu\/.+\.webp$/);
    const asset = await ctx
      .http()
      .get(new URL(done.body.imageUrl).pathname)
      .buffer(true)
      .parse((r, cb) => {
        const chunks: Buffer[] = [];
        r.on('data', (c: Buffer) => chunks.push(c));
        r.on('end', () => cb(null, Buffer.concat(chunks)));
      })
      .expect(200);
    const meta = await sharp(asset.body as Buffer).metadata();
    expect(meta.format).toBe('webp');
    expect(meta.width).toBe(640);
    expect((asset.body as Buffer).length).toBeLessThan(60_000);
  });

  it('refuses to process an upload that belongs to another venue', async () => {
    const owner = await loginOwner(ctx);
    const menu = await owner.get('/v1/admin/menu').expect(200);
    const item = menu.body[0].items[0];
    await owner
      .post(`/v1/admin/menu/items/${item.id}/image`)
      .send({ uploadKey: 'uploads/00000000-0000-7000-8000-000000000000/x' })
      .expect(403);
  });
});

describe('staff management', () => {
  it('adds a waiter who can then PIN in, and deactivation signs them out', async () => {
    const owner = await loginOwner(ctx);
    const created = await owner
      .post('/v1/admin/staff')
      .send({ name: 'Ngozi Waiter', role: 'WAITER', pin: '6543' })
      .expect(201);
    expect(created.body).toMatchObject({
      name: 'Ngozi Waiter',
      role: 'WAITER',
      email: null,
      active: true,
    });
    await owner.post('/v1/auth/device').send({ name: 'Floor phone' }).expect(201);
    await owner
      .post('/v1/auth/pin-login')
      .send({ staffId: created.body.id, pin: '6543' })
      .expect(200);
    await owner.get('/v1/auth/me').expect(200);
    const admin = await loginOwner(ctx);
    await admin.patch(`/v1/admin/staff/${created.body.id}`).send({ active: false }).expect(200);
    await owner.get('/v1/auth/me').expect(401);
    expect(
      await ctx.raw.auditEvent.count({
        where: { action: { in: ['STAFF_CREATED', 'STAFF_UPDATED'] }, entityId: created.body.id },
      }),
    ).toBe(2);
  });

  it('does not let managers create owners or waiters get passwords', async () => {
    const manager = await loginManager(ctx);
    await manager
      .post('/v1/admin/staff')
      .send({
        name: 'New Owner',
        role: 'OWNER',
        pin: '1212',
        email: 'o2@x.co',
        password: 'password-123',
      })
      .expect(403);
    const res = await manager
      .post('/v1/admin/staff')
      .send({ name: 'W', role: 'WAITER', pin: '1212', email: 'w@x.co' })
      .expect(400);
    expect(res.body.error.code).toBe('VALIDATION_FAILED');
  });

  it('lists and revokes devices', async () => {
    const owner = await loginOwner(ctx);
    const enabled = await owner.post('/v1/auth/device').send({ name: 'Old tablet' }).expect(201);
    const devices = await owner.get('/v1/admin/devices').expect(200);
    expect(devices.body.some((d: { id: string }) => d.id === enabled.body.deviceId)).toBe(true);
    await owner.post(`/v1/admin/devices/${enabled.body.deviceId}/revoke`).expect(200);
    const info = await owner.get('/v1/auth/device').expect(401);
    expect(info.body.error.code).toBe('DEVICE_NOT_REGISTERED');
  });
});

describe('tenant isolation over HTTP', () => {
  it('cannot read or change another venue’s data', async () => {
    const rival = await otherVenueOwner();
    const demoItem = await ctx.raw.menuItem.findFirstOrThrow({ where: { venueId: ctx.venueId } });
    const demoTable = await ctx.raw.table.findFirstOrThrow({ where: { venueId: ctx.venueId } });
    const demoStaff = await ctx.raw.staffMember.findFirstOrThrow({
      where: { venueId: ctx.venueId, role: 'WAITER' },
    });
    const rivalMenu = await rival.get('/v1/admin/menu').expect(200);
    expect(rivalMenu.body).toEqual([]);
    expect((await rival.get('/v1/admin/tables').expect(200)).body).toEqual([]);
    await rival.patch(`/v1/admin/menu/items/${demoItem.id}`).send({ priceKobo: 1 }).expect(404);
    await rival
      .patch(`/v1/admin/menu/items/${demoItem.id}/availability`)
      .send({ isAvailable: false })
      .expect(404);
    await rival.patch(`/v1/admin/tables/${demoTable.id}`).send({ label: 'Mine' }).expect(404);
    await rival.patch(`/v1/admin/staff/${demoStaff.id}`).send({ pin: '0000' }).expect(404);
    await rival
      .post(`/v1/admin/menu/items/${demoItem.id}/add-ons`)
      .send({ name: 'x', priceDeltaKobo: 0 })
      .expect(404);
    const unchanged = await ctx.raw.menuItem.findUniqueOrThrow({ where: { id: demoItem.id } });
    expect(unchanged.priceKobo).toBe(demoItem.priceKobo);
    expect(unchanged.isAvailable).toBe(demoItem.isAvailable);
  });
});
