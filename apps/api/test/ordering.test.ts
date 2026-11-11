import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { SocketEvent } from '@app/shared';
import { createTestContext, idem, loginOwner, pinAgent, type TestContext } from './helpers';
import {
  connectSocket,
  cookieHeader,
  listen,
  menuItem,
  nextEvent,
  tableLink,
} from './ordering-helpers';

let ctx: TestContext;
let waiter: Awaited<ReturnType<typeof pinAgent>>;
let station: Awaited<ReturnType<typeof pinAgent>>;

beforeAll(async () => {
  ctx = await createTestContext();
  waiter = await pinAgent(ctx, 'WAITER');
  station = await pinAgent(ctx, 'STATION');
});
afterAll(async () => {
  await ctx?.close();
});

describe('anti-prank: nobody can order to a table a waiter has not opened', () => {
  it('shows a read-only menu and refuses to join or order', async () => {
    const { base } = await tableLink(ctx, 'M1');
    const landing = await ctx.http().get(base).expect(200);
    expect(landing.body.open).toBe(false);
    expect(landing.body.joined).toBe(false);
    expect(landing.body.venue.name).toBe('Demo Lounge');
    expect(landing.body.menu.length).toBeGreaterThan(0);
    const join = await ctx.http().post(`${base}/join`).expect(409);
    expect(join.body.error.code).toBe('TABLE_NOT_OPEN');
    const order = await ctx
      .http()
      .post('/v1/public/session/orders')
      .send({ items: [] })
      .expect(401);
    expect(order.body.error.code).toBe('UNAUTHENTICATED');
  });

  it('a customer cookie from an earlier, closed session cannot order', async () => {
    const { table, base } = await tableLink(ctx, 'M6');
    const opened = await waiter.post(`/v1/staff/tables/${table.id}/open`).set(idem()).expect(201);
    const cust = ctx.agent();
    await cust.post(`${base}/join`).expect(200);
    await waiter.post(`/v1/staff/sessions/${opened.body.tableSessionId}/close`).expect(200);
    const jollof = await menuItem(ctx, 'Jollof Rice');
    const res = await cust
      .post('/v1/public/session/orders')
      .send({ items: [{ menuItemId: jollof.id, quantity: 1 }] })
      .expect(409);
    expect(res.body.error.code).toBe('TABLE_NOT_OPEN');
  });

  it('lets customers call the waiter before the table is open, without spamming', async () => {
    const { base, table } = await tableLink(ctx, 'M2');
    const first = await ctx.http().post(`${base}/call-waiter`).expect(201);
    const second = await ctx.http().post(`${base}/call-waiter`).expect(201);
    expect(second.body.id).toBe(first.body.id);
    const floor = await waiter.get('/v1/staff/floor').expect(200);
    const m2 = floor.body.tables.find((t: { id: string }) => t.id === table.id);
    expect(m2.state).toBe('CLOSED');
    expect(m2.waiterCalled).toBe(true);
    await waiter.post(`/v1/staff/service-requests/${first.body.id}/ack`).expect(200);
    const after = await waiter.get('/v1/staff/floor').expect(200);
    expect(after.body.tables.find((t: { id: string }) => t.id === table.id).waiterCalled).toBe(
      false,
    );
  });

  it('rejects forged, foreign and rotated QR tokens', async () => {
    const { base, table } = await tableLink(ctx, 'M3');
    const forged = base.slice(0, -3) + 'abc';
    expect((await ctx.http().get(forged).expect(404)).body.error.code).toBe('INVALID_TABLE_TOKEN');
    expect(
      (await ctx.http().get(base.replace('demo-lounge', 'other-venue')).expect(404)).body.error
        .code,
    ).toBe('INVALID_TABLE_TOKEN');
    const owner = await loginOwner(ctx);
    await owner
      .post('/v1/admin/tables/rotate-qr')
      .send({ tableIds: [table.id] })
      .expect(200);
    expect((await ctx.http().get(base).expect(404)).body.error.code).toBe('INVALID_TABLE_TOKEN');
    const fresh = await tableLink(ctx, 'M3');
    await ctx.http().get(fresh.base).expect(200);
  });

  it('shows a polite error for suspended venues', async () => {
    const { base } = await tableLink(ctx, 'M4');
    await ctx.raw.venue.update({ where: { id: ctx.venueId }, data: { status: 'SUSPENDED' } });
    try {
      const res = await ctx.http().get(base).expect(403);
      expect(res.body.error.code).toBe('VENUE_SUSPENDED');
      expect(res.body.error.details.venueName).toBe('Demo Lounge');
    } finally {
      await ctx.raw.venue.update({ where: { id: ctx.venueId }, data: { status: 'ACTIVE' } });
    }
  });
});

describe('the ordering loop', () => {
  let tableSessionId: string;
  let base: string;
  const alice = () => aliceAgent;
  let aliceAgent: ReturnType<TestContext['agent']>;
  let bobAgent: ReturnType<TestContext['agent']>;

  it('waiter opens the table; staff without floor rights cannot', async () => {
    const link = await tableLink(ctx, 'T1');
    base = link.base;
    await station.post(`/v1/staff/tables/${link.table.id}/open`).expect(403);
    const res = await waiter.post(`/v1/staff/tables/${link.table.id}/open`).set(idem()).expect(201);
    tableSessionId = res.body.tableSessionId;
    const again = await waiter.post(`/v1/staff/tables/${link.table.id}/open`).expect(409);
    expect(again.body.error.code).toBe('TABLE_ALREADY_OPEN');
    expect(
      await ctx.raw.auditEvent.count({
        where: { action: 'TABLE_OPENED', entityId: tableSessionId },
      }),
    ).toBe(1);
    const tab = await ctx.raw.tab.findUniqueOrThrow({ where: { tableSessionId } });
    expect(tab).toMatchObject({
      vatBps: 750,
      serviceChargeBps: 0,
      pricesIncludeVat: true,
      totalKobo: 0,
    });
  });

  it('two customers join the same tab; rescanning restores the session', async () => {
    aliceAgent = ctx.agent();
    bobAgent = ctx.agent();
    const a1 = await aliceAgent.post(`${base}/join`).expect(200);
    const b1 = await bobAgent.post(`${base}/join`).expect(200);
    expect(a1.body.tableSessionId).toBe(tableSessionId);
    expect(b1.body.tableSessionId).toBe(tableSessionId);
    expect(a1.headers['set-cookie']?.[0]).toMatch(/qr_customer=.*HttpOnly/i);
    const landing = await aliceAgent.get(base).expect(200);
    expect(landing.body).toMatchObject({ open: true, joined: true });
    await aliceAgent.post(`${base}/join`).expect(200);
    expect(await ctx.raw.customerSession.count({ where: { tableSessionId } })).toBe(2);
  });

  it('places orders with add-ons and notes, snapshotting prices', async () => {
    const jollof = await menuItem(ctx, 'Jollof Rice');
    const plantain = jollof.addOns.find((a) => a.name === 'Extra plantain')!;
    const chapman = await menuItem(ctx, 'Chapman');
    const res = await alice()
      .post('/v1/public/session/orders')
      .set(idem())
      .send({
        items: [
          { menuItemId: jollof.id, quantity: 2, addOnIds: [plantain.id], note: 'Not too spicy' },
          { menuItemId: chapman.id, quantity: 1 },
        ],
      })
      .expect(201);
    expect(res.body).toMatchObject({ number: 1, status: 'PLACED', mine: true });
    const jollofLine = res.body.items.find((i: { name: string }) => i.name === 'Jollof Rice');
    expect(jollofLine).toMatchObject({
      unitPriceKobo: 400_000,
      quantity: 2,
      lineTotalKobo: 800_000,
      note: 'Not too spicy',
      status: 'SENT',
    });
    expect(jollofLine.addOns).toEqual([
      { id: plantain.id, name: 'Extra plantain', priceDeltaKobo: 50_000 },
    ]);
    const zobo = await menuItem(ctx, 'Zobo');
    await bobAgent
      .post('/v1/public/session/orders')
      .send({ items: [{ menuItemId: zobo.id, quantity: 2 }] })
      .expect(201);

    // Later price changes do not touch existing tabs.
    await ctx.raw.menuItem.update({ where: { id: jollof.id }, data: { priceKobo: 999_900 } });
    const session = await alice().get('/v1/public/session').expect(200);
    expect(session.body.tab.totals).toMatchObject({
      subtotalKobo: 800_000 + 250_000 + 300_000,
      totalKobo: 1_350_000,
      balanceKobo: 1_350_000,
    });
    expect(session.body.tab.totals.vatIncludedKobo).toBe(94_186);
    expect(session.body.tab.orders.map((o: { mine: boolean }) => o.mine)).toEqual([true, false]);
    await ctx.raw.menuItem.update({ where: { id: jollof.id }, data: { priceKobo: 350_000 } });
  });

  it('refuses sold-out items and add-ons from another item', async () => {
    const soup = await menuItem(ctx, 'Catfish Pepper Soup');
    await ctx.raw.menuItem.update({ where: { id: soup.id }, data: { isAvailable: false } });
    const res = await alice()
      .post('/v1/public/session/orders')
      .send({ items: [{ menuItemId: soup.id, quantity: 1 }] })
      .expect(409);
    expect(res.body.error).toMatchObject({
      code: 'ITEM_UNAVAILABLE',
      details: { menuItemIds: [soup.id] },
    });
    await ctx.raw.menuItem.update({ where: { id: soup.id }, data: { isAvailable: true } });
    const jollof = await menuItem(ctx, 'Jollof Rice');
    const zobo = await menuItem(ctx, 'Zobo');
    await alice()
      .post('/v1/public/session/orders')
      .send({ items: [{ menuItemId: zobo.id, quantity: 1, addOnIds: [jollof.addOns[0]!.id] }] })
      .expect(409);
  });

  it('runs the station flow: accept, unavailable (not charged, switched off, undo), ready, served', async () => {
    const stations = await station.get('/v1/staff/stations').expect(200);
    const kitchen = stations.body.find((s: { name: string }) => s.name === 'Kitchen');
    const bar = stations.body.find((s: { name: string }) => s.name === 'Bar');
    const kq = await station.get(`/v1/staff/stations/${kitchen.id}/queue`).expect(200);
    const bq = await station.get(`/v1/staff/stations/${bar.id}/queue`).expect(200);
    expect(kq.body.items.map((i: { name: string }) => i.name)).toEqual(['Jollof Rice']);
    expect(bq.body.items.map((i: { name: string }) => i.name)).toEqual(['Chapman', 'Zobo']);
    expect(kq.body.items[0]).toMatchObject({
      tableLabel: 'T1',
      quantity: 2,
      note: 'Not too spicy',
      addOns: [{ name: 'Extra plantain' }],
    });

    const jollofItem = kq.body.items[0].id;
    const [chapmanItem, zoboItem] = bq.body.items.map((i: { id: string }) => i.id);

    await waiter.post(`/v1/staff/order-items/${jollofItem}/accept`).expect(403);
    const early = await waiter.post(`/v1/staff/order-items/${jollofItem}/serve`).expect(409);
    expect(early.body.error.code).toBe('INVALID_TRANSITION');

    await station.post(`/v1/staff/order-items/${jollofItem}/accept`).set(idem()).expect(200);
    await station.post(`/v1/staff/order-items/${chapmanItem}/accept`).expect(200);
    await station.post(`/v1/staff/order-items/${zoboItem}/unavailable`).send({}).expect(200);

    const zobo = await menuItem(ctx, 'Zobo');
    expect(zobo.isAvailable).toBe(false);
    expect(
      await ctx.raw.auditEvent.count({
        where: { action: 'MENU_AVAILABILITY_CHANGED', entityId: zobo.id },
      }),
    ).toBe(1);
    let tab = await alice().get('/v1/public/session').expect(200);
    expect(tab.body.tab.totals.totalKobo).toBe(1_050_000);
    const zoboLine = tab.body.tab.orders[1].items[0];
    expect(zoboLine).toMatchObject({ status: 'UNAVAILABLE', billable: false });

    // One-tap undo puts the item back in the queue and on the menu.
    const recent = await station.get(`/v1/staff/stations/${bar.id}/queue`).expect(200);
    expect(recent.body.recentlyUnavailable.map((i: { id: string }) => i.id)).toEqual([zoboItem]);
    await station.post(`/v1/staff/order-items/${zoboItem}/undo-unavailable`).expect(200);
    expect((await menuItem(ctx, 'Zobo')).isAvailable).toBe(true);
    tab = await alice().get('/v1/public/session').expect(200);
    expect(tab.body.tab.totals.totalKobo).toBe(1_350_000);
    // ... and this time mark it unavailable without switching the menu item off.
    await station
      .post(`/v1/staff/order-items/${zoboItem}/unavailable`)
      .send({ disableMenuItem: false })
      .expect(200);
    expect((await menuItem(ctx, 'Zobo')).isAvailable).toBe(true);

    await station.post(`/v1/staff/order-items/${jollofItem}/ready`).expect(200);
    await station.post(`/v1/staff/order-items/${chapmanItem}/ready`).expect(200);
    const floor = await waiter.get('/v1/staff/floor').expect(200);
    const t1 = floor.body.tables.find((t: { label: string }) => t.label === 'T1');
    expect(t1).toMatchObject({
      state: 'OPEN',
      itemsReady: 2,
      itemsPending: 0,
      balanceKobo: 1_050_000,
    });
    expect(floor.body.readyItems.map((i: { name: string }) => i.name).sort()).toEqual([
      'Chapman',
      'Jollof Rice',
    ]);

    await waiter.post(`/v1/staff/order-items/${jollofItem}/serve`).expect(200);
    await waiter.post(`/v1/staff/order-items/${chapmanItem}/serve`).expect(200);
    const doubleServe = await waiter.post(`/v1/staff/order-items/${chapmanItem}/serve`).expect(409);
    expect(doubleServe.body.error.code).toBe('INVALID_TRANSITION');
    const queue = await station.get(`/v1/staff/stations/${kitchen.id}/queue`).expect(200);
    expect(queue.body.items).toEqual([]);
    const staffTab = await waiter.get(`/v1/staff/sessions/${tableSessionId}`).expect(200);
    expect(
      staffTab.body.tab.orders
        .flatMap((o: { items: { status: string }[] }) => o.items.map((i) => i.status))
        .sort(),
    ).toEqual(['SERVED', 'SERVED', 'UNAVAILABLE']);
  });

  it('handles "request bill" and refuses to close a table with a balance', async () => {
    const req = await alice()
      .post('/v1/public/session/requests')
      .send({ type: 'REQUEST_BILL' })
      .expect(201);
    const floor = await waiter.get('/v1/staff/floor').expect(200);
    expect(floor.body.tables.find((t: { label: string }) => t.label === 'T1').billRequested).toBe(
      true,
    );
    await waiter.post(`/v1/staff/service-requests/${req.body.id}/ack`).expect(200);
    const close = await waiter.post(`/v1/staff/sessions/${tableSessionId}/close`).expect(409);
    expect(close.body.error).toMatchObject({
      code: 'TAB_HAS_BALANCE',
      details: { balanceKobo: 1_050_000 },
    });
  });

  it('closes an empty table and audits it', async () => {
    const { table } = await tableLink(ctx, 'T2');
    const opened = await waiter.post(`/v1/staff/tables/${table.id}/open`).expect(201);
    await waiter.post(`/v1/staff/sessions/${opened.body.tableSessionId}/close`).expect(200);
    expect(
      await ctx.raw.auditEvent.count({
        where: { action: 'TABLE_CLOSED', entityId: opened.body.tableSessionId },
      }),
    ).toBe(1);
    const tab = await ctx.raw.tab.findUniqueOrThrow({
      where: { tableSessionId: opened.body.tableSessionId },
    });
    expect(tab.status).toBe('CLOSED');
  });
});

describe('realtime notifications', () => {
  it('unlocks ordering live for a read-only scanner and notifies staff and stations', async () => {
    const url = await listen(ctx);
    const { table, token, base } = await tableLink(ctx, 'VIP1');
    const owner = await ctx
      .http()
      .post('/v1/auth/login')
      .send({ email: 'owner@demo.test', password: 'demo-owner-pass' })
      .expect(200);
    const staffSocket = await connectSocket(url, cookieHeader(owner.headers['set-cookie']));
    const scanner = await connectSocket(url);
    const ack = await scanner.emitWithAck('subscribe.table', {
      venueSlug: 'demo-lounge',
      tableToken: token,
    });
    expect(ack).toEqual({ ok: true });
    const bad = await scanner.emitWithAck('subscribe.table', {
      venueSlug: 'demo-lounge',
      tableToken: 'x'.repeat(70),
    });
    expect(bad.ok).toBe(false);

    const opened = nextEvent<{ tableId: string }>(scanner, SocketEvent.TABLE_SESSION_OPENED);
    const floorChanged = nextEvent(staffSocket, SocketEvent.FLOOR_CHANGED);
    await waiter.post(`/v1/staff/tables/${table.id}/open`).expect(201);
    expect((await opened).tableId).toBe(table.id);
    await floorChanged;

    // Customer joins, then reconnects so the socket carries the customer cookie.
    const join = await ctx.http().post(`${base}/join`).expect(200);
    const custCookie = cookieHeader(join.headers['set-cookie']);
    const customerSocket = await connectSocket(url, custCookie);

    // Station screen subscribes to its station room.
    const stationCookie = await ctx
      .http()
      .post('/v1/auth/login')
      .send({ email: 'manager@demo.test', password: 'demo-manager-pass' })
      .expect(200);
    const stationSocket = await connectSocket(
      url,
      cookieHeader(stationCookie.headers['set-cookie']),
    );
    const kitchen = await ctx.raw.station.findFirstOrThrow({
      where: { venueId: ctx.venueId, name: 'Kitchen' },
    });
    expect(await stationSocket.emitWithAck('subscribe.station', { stationId: kitchen.id })).toEqual(
      { ok: true },
    );
    expect((await scanner.emitWithAck('subscribe.station', { stationId: kitchen.id })).ok).toBe(
      false,
    );

    const suya = await menuItem(ctx, 'Beef Suya');
    const queueChanged = nextEvent<{ stationId: string }>(
      stationSocket,
      SocketEvent.STATION_QUEUE_CHANGED,
    );
    const tabUpdated = nextEvent<{ version: number }>(customerSocket, SocketEvent.TAB_UPDATED);
    const orderCreated = nextEvent(staffSocket, SocketEvent.ORDER_CREATED);
    await ctx
      .http()
      .post('/v1/public/session/orders')
      .set('Cookie', custCookie)
      .send({ items: [{ menuItemId: suya.id, quantity: 1 }] })
      .expect(201);
    expect((await queueChanged).stationId).toBe(kitchen.id);
    expect((await tabUpdated).version).toBeGreaterThan(1);
    await orderCreated;

    // Menu availability reaches scanners and customers.
    const menuChanged = nextEvent<{ menuItemId: string }>(scanner, SocketEvent.MENU_CHANGED);
    const ownerAgent = await loginOwner(ctx);
    await ownerAgent
      .patch(`/v1/admin/menu/items/${suya.id}/availability`)
      .send({ isAvailable: false })
      .expect(200);
    expect((await menuChanged).menuItemId).toBe(suya.id);

    for (const s of [staffSocket, scanner, customerSocket, stationSocket]) s.disconnect();
  });
});
