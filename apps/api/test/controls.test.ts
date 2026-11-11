import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  createTestContext,
  DEMO,
  idem,
  loginOwner,
  pinAgent,
  staffByRole,
  type TestContext,
} from './helpers';
import { menuItem, tableLink } from './ordering-helpers';

let ctx: TestContext;
let waiter: Awaited<ReturnType<typeof pinAgent>>;

beforeAll(async () => {
  ctx = await createTestContext();
  waiter = await pinAgent(ctx, 'WAITER');
});
afterAll(async () => {
  await ctx?.close();
});

async function openWithOrder(label: string) {
  const { table, base } = await tableLink(ctx, label);
  const opened = await waiter.post(`/v1/staff/tables/${table.id}/open`).expect(201);
  const cust = ctx.agent();
  await cust.post(`${base}/join`).expect(200);
  const jollof = await menuItem(ctx, 'Jollof Rice');
  const chapman = await menuItem(ctx, 'Chapman');
  await cust
    .post('/v1/public/session/orders')
    .send({
      items: [
        { menuItemId: jollof.id, quantity: 2 },
        { menuItemId: chapman.id, quantity: 1 },
      ],
    })
    .expect(201);
  const tab = await waiter.get(`/v1/staff/sessions/${opened.body.tableSessionId}`).expect(200);
  const items = tab.body.tab.orders[0].items as { id: string; name: string }[];
  return { tableSessionId: opened.body.tableSessionId as string, cust, items };
}

describe('voids and discounts need a manager PIN and a reason', () => {
  it('lists approvers (managers and owners only)', async () => {
    const res = await waiter.get('/v1/staff/approvers').expect(200);
    expect(res.body.map((s: { role: string }) => s.role).sort()).toEqual(['MANAGER', 'OWNER']);
  });

  it('refuses without a valid approver PIN, a manager role or a reason', async () => {
    const { tableSessionId, items } = await openWithOrder('M1');
    const manager = await staffByRole(ctx, 'MANAGER');
    const waiterRow = await staffByRole(ctx, 'WAITER');
    const wrong = await waiter
      .post(`/v1/staff/sessions/${tableSessionId}/adjustments`)
      .send({
        type: 'VOID',
        orderItemId: items[0]!.id,
        reason: 'Customer changed mind',
        approver: { staffId: manager.id, pin: '0000' },
      })
      .expect(401);
    expect(wrong.body.error.code).toBe('INVALID_CREDENTIALS');
    const notManager = await waiter
      .post(`/v1/staff/sessions/${tableSessionId}/adjustments`)
      .send({
        type: 'VOID',
        orderItemId: items[0]!.id,
        reason: 'Customer changed mind',
        approver: { staffId: waiterRow.id, pin: DEMO.waiter.pin },
      })
      .expect(403);
    expect(notManager.body.error.code).toBe('APPROVAL_REQUIRED');
    await waiter
      .post(`/v1/staff/sessions/${tableSessionId}/adjustments`)
      .send({
        type: 'VOID',
        orderItemId: items[0]!.id,
        reason: '',
        approver: { staffId: manager.id, pin: DEMO.manager.pin },
      })
      .expect(400);
    const station = await pinAgent(ctx, 'STATION');
    await station
      .post(`/v1/staff/sessions/${tableSessionId}/adjustments`)
      .send({
        type: 'VOID',
        orderItemId: items[0]!.id,
        reason: 'x x x',
        approver: { staffId: manager.id, pin: DEMO.manager.pin },
      })
      .expect(403);
    const tab = await waiter.get(`/v1/staff/sessions/${tableSessionId}`).expect(200);
    expect(tab.body.tab.adjustments).toEqual([]);
    await ctx.raw.staffMember.update({ where: { id: manager.id }, data: { failedPinAttempts: 0 } });
  });

  it('voids an item and applies discounts with requester, approver and reason recorded', async () => {
    const { tableSessionId, items, cust } = await openWithOrder('M2');
    const manager = await staffByRole(ctx, 'MANAGER');
    const owner = await staffByRole(ctx, 'OWNER');
    const waiterRow = await staffByRole(ctx, 'WAITER');
    const chapman = items.find((i) => i.name === 'Chapman')!;
    // 2 x 3,500 + 2,500 = 9,500
    const voided = await waiter
      .post(`/v1/staff/sessions/${tableSessionId}/adjustments`)
      .set(idem())
      .send({
        type: 'VOID',
        orderItemId: chapman.id,
        reason: 'Spilled, not served',
        approver: { staffId: manager.id, pin: DEMO.manager.pin },
      })
      .expect(201);
    expect(voided.body).toMatchObject({
      type: 'VOID',
      appliedKobo: 250_000,
      requestedBy: { name: 'Chidi Waiter' },
      approvedBy: { name: 'Musa Bello' },
    });
    const pct = await waiter
      .post(`/v1/staff/sessions/${tableSessionId}/adjustments`)
      .send({
        type: 'DISCOUNT',
        kind: 'PERCENT',
        percentBps: 1000,
        reason: 'Regular customer',
        approver: { staffId: owner.id, pin: DEMO.owner.pin },
      })
      .expect(201);
    expect(pct.body.appliedKobo).toBe(70_000);
    await waiter
      .post(`/v1/staff/sessions/${tableSessionId}/adjustments`)
      .send({
        type: 'DISCOUNT',
        kind: 'AMOUNT',
        amountKobo: 30_000,
        orderItemId: items[0]!.id,
        reason: 'Late food',
        approver: { staffId: manager.id, pin: DEMO.manager.pin },
      })
      .expect(201);
    // Voiding twice is refused.
    const again = await waiter
      .post(`/v1/staff/sessions/${tableSessionId}/adjustments`)
      .send({
        type: 'VOID',
        orderItemId: chapman.id,
        reason: 'Again',
        approver: { staffId: manager.id, pin: DEMO.manager.pin },
      })
      .expect(409);
    expect(again.body.error.code).toBe('INVALID_TRANSITION');

    const session = await cust.get('/v1/public/session').expect(200);
    // 7,000 - 300 (item) = 6,700; 10% → 670 → 6,030
    expect(session.body.tab.totals).toMatchObject({
      subtotalKobo: 700_000,
      discountKobo: 97_000,
      totalKobo: 603_000,
    });
    const items2 = session.body.tab.orders[0].items;
    expect(items2.find((i: { id: string }) => i.id === chapman.id).status).toBe('VOIDED');

    const adj = await ctx.raw.adjustment.findMany({
      where: { tab: { tableSessionId } },
      orderBy: { createdAt: 'asc' },
    });
    expect(adj.map((a) => [a.type, a.requestedByStaffId, a.approvedByStaffId])).toEqual([
      ['VOID', waiterRow.id, manager.id],
      ['DISCOUNT', waiterRow.id, owner.id],
      ['DISCOUNT', waiterRow.id, manager.id],
    ]);
    const audits = await ctx.raw.auditEvent.findMany({
      where: { action: { in: ['ITEM_VOIDED', 'DISCOUNT_APPLIED'] } },
      orderBy: { createdAt: 'asc' },
    });
    expect(audits).toHaveLength(3);
    expect(audits.every((a) => a.approverId && a.reason)).toBe(true);
  });
});

describe('owner dashboard and audit log', () => {
  it('shows sales today by method, open tabs, voids/discounts with approvers', async () => {
    const { tableSessionId, cust } = await openWithOrder('T1');
    const start = await cust
      .post('/v1/public/session/payments')
      .send({ mode: 'CUSTOM', amountKobo: 300_000, email: 'd@example.com' })
      .expect(201);
    await ctx
      .http()
      .post(`/v1/dev/mock-pay/${start.body.reference}/complete`)
      .send({ outcome: 'success', channel: 'card' })
      .expect(200);
    await waiter
      .post(`/v1/staff/sessions/${tableSessionId}/payments`)
      .send({ method: 'POS', amountKobo: 650_000 })
      .expect(201);

    const owner = await loginOwner(ctx);
    const dash = await owner.get('/v1/admin/dashboard').expect(200);
    expect(dash.body.salesTodayKobo).toBe(950_000);
    expect(dash.body.byBucket).toMatchObject({
      CARD: 300_000,
      POS: 650_000,
      CASH: 0,
      TRANSFER: 0,
      USSD: 0,
    });
    const tabs = dash.body.openTabs.map((t: { tableLabel: string }) => t.tableLabel).sort();
    expect(tabs).toEqual(['M1', 'M2', 'T1']);
    expect(
      dash.body.openTabs.find((t: { tableLabel: string }) => t.tableLabel === 'T1').balanceKobo,
    ).toBe(0);
    expect(dash.body.adjustmentsToday).toHaveLength(3);
    expect(
      dash.body.adjustmentsToday.every((a: { approvedBy: { name: string } }) =>
        ['Musa Bello', 'Ada Okafor'].includes(a.approvedBy.name),
      ),
    ).toBe(true);
    await waiter.get('/v1/admin/dashboard').expect(403);
  });

  it('pages through the audit log with names', async () => {
    const owner = await loginOwner(ctx);
    const first = await owner.get('/v1/admin/audit?limit=5').expect(200);
    expect(first.body.events).toHaveLength(5);
    expect(first.body.nextCursor).toBeTruthy();
    const second = await owner
      .get(`/v1/admin/audit?limit=5&cursor=${first.body.nextCursor}`)
      .expect(200);
    expect(second.body.events[0].id).not.toBe(first.body.events[0].id);
    const voids = await owner.get('/v1/admin/audit?action=ITEM_VOIDED').expect(200);
    expect(voids.body.events[0]).toMatchObject({
      action: 'ITEM_VOIDED',
      actorName: 'Chidi Waiter',
      approverName: 'Musa Bello',
      reason: 'Spilled, not served',
    });
    await waiter.get('/v1/admin/audit').expect(403);
  });
});

describe('platform admin', () => {
  it('lists venues with setup status and suspends/reactivates them', async () => {
    const admin = ctx.agent();
    await admin
      .post('/v1/platform/auth/login')
      .send({ email: DEMO.admin.email, password: DEMO.admin.password })
      .expect(200);
    const list = await admin.get('/v1/platform/venues').expect(200);
    const demo = list.body.find((v: { slug: string }) => v.slug === 'demo-lounge');
    expect(demo).toMatchObject({ status: 'ACTIVE', ownerEmail: DEMO.owner.email });
    expect(demo.checklist.items.length).toBeGreaterThan(0);
    expect(demo.ordersToday).toBeGreaterThan(0);

    await admin
      .post(`/v1/platform/venues/${demo.id}/suspend`)
      .send({ reason: 'Subscription unpaid' })
      .expect(200);
    const { base } = await tableLink(ctx, 'T4');
    expect((await ctx.http().get(base).expect(403)).body.error.code).toBe('VENUE_SUSPENDED');
    const audit = await ctx.raw.auditEvent.findFirstOrThrow({
      where: { action: 'VENUE_SUSPENDED' },
    });
    expect(audit).toMatchObject({ actorType: 'PLATFORM_ADMIN', reason: 'Subscription unpaid' });
    const me = await (await loginOwner(ctx)).get('/v1/auth/me').expect(200);
    expect(me.body.venue.status).toBe('SUSPENDED');

    await admin.post(`/v1/platform/venues/${demo.id}/activate`).send({}).expect(200);
    await ctx.http().get(base).expect(200);
  });

  it('is not reachable with a staff session', async () => {
    const owner = await loginOwner(ctx);
    await owner.get('/v1/platform/venues').expect(401);
  });
});
