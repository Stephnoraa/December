import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { MockPaymentProvider } from '../src/payments/mock.provider';
import { PAYMENT_PROVIDER, PaymentsService } from '../src/payments/payments.service';
import { paystackSignature } from '../src/payments/signature';
import {
  createTestContext,
  idem,
  loginManager,
  loginOwner,
  pinAgent,
  type TestContext,
} from './helpers';
import { menuItem, tableLink } from './ordering-helpers';

let ctx: TestContext;
let waiter: Awaited<ReturnType<typeof pinAgent>>;
let station: Awaited<ReturnType<typeof pinAgent>>;
const SECRET = 'sk_test_mock_secret_for_signatures';

beforeAll(async () => {
  ctx = await createTestContext();
  waiter = await pinAgent(ctx, 'WAITER');
  station = await pinAgent(ctx, 'STATION');
});
afterAll(async () => {
  await ctx?.close();
});

/** Opens a table, joins two customers and orders; returns agents and the session id. */
async function tableWithOrder(label: string, items: { name: string; quantity: number }[]) {
  const { table, base } = await tableLink(ctx, label);
  const opened = await waiter.post(`/v1/staff/tables/${table.id}/open`).expect(201);
  const a = ctx.agent();
  const b = ctx.agent();
  await a.post(`${base}/join`).expect(200);
  await b.post(`${base}/join`).expect(200);
  const lines = [];
  for (const i of items)
    lines.push({ menuItemId: (await menuItem(ctx, i.name)).id, quantity: i.quantity });
  const order = await a
    .post('/v1/public/session/orders')
    .set(idem())
    .send({ items: lines })
    .expect(201);
  return { a, b, tableSessionId: opened.body.tableSessionId as string, order: order.body, table };
}

const complete = (reference: string, outcome: 'success' | 'failed' = 'success', channel = 'card') =>
  ctx.http().post(`/v1/dev/mock-pay/${reference}/complete`).send({ outcome, channel }).expect(200);

const mock = () => ctx.app.get<MockPaymentProvider>(PAYMENT_PROVIDER);

describe('online payments (Paystack via the mock provider)', () => {
  it('pays part online, never trusting the redirect, then the rest in cash; table closes', async () => {
    const { a, b, tableSessionId } = await tableWithOrder('M1', [
      { name: 'Jollof Rice', quantity: 2 },
      { name: 'Chapman', quantity: 2 },
    ]);
    // 2 x 3,500 + 2 x 2,500 = 12,000 (VAT inclusive)
    const startRes = await a
      .post('/v1/public/session/payments')
      .set(idem())
      .send({ mode: 'CUSTOM', amountKobo: 500_000, email: 'ada@example.com' })
      .expect(201);
    expect(startRes.body.authorizationUrl).toMatch(/\/mock-pay\/qr-/);
    const ref = startRes.body.reference as string;

    // Returning from checkout without paying: still pending, nothing applied.
    const pending = await a.get(`/v1/public/payments/${ref}`).expect(200);
    expect(pending.body.status).toBe('PENDING');
    // Bob cannot grab the part Ada is paying.
    const bobFull = await b
      .post('/v1/public/session/payments')
      .send({ mode: 'CUSTOM', amountKobo: 800_000, email: 'bob@example.com' })
      .expect(409);
    expect(bobFull.body.error).toMatchObject({
      code: 'BALANCE_RESERVED',
      details: { availableKobo: 700_000 },
    });

    await complete(ref, 'success', 'bank_transfer');
    const paid = await a.get(`/v1/public/payments/${ref}`).expect(200);
    expect(paid.body).toMatchObject({
      status: 'SUCCESS',
      amountKobo: 500_000,
      tabBalanceKobo: 700_000,
    });
    const payment = await ctx.raw.payment.findUniqueOrThrow({ where: { reference: ref } });
    expect(payment.channel).toBe('bank_transfer');
    expect(
      await ctx.raw.auditEvent.count({
        where: { action: 'PAYMENT_CONFIRMED', entityId: payment.id },
      }),
    ).toBe(1);

    // Waiter records the rest as cash; more than the balance is refused.
    const over = await waiter
      .post(`/v1/staff/sessions/${tableSessionId}/payments`)
      .send({ method: 'CASH', amountKobo: 800_000 })
      .expect(409);
    expect(over.body.error.code).toBe('AMOUNT_EXCEEDS_BALANCE');
    await station
      .post(`/v1/staff/sessions/${tableSessionId}/payments`)
      .send({ method: 'CASH', amountKobo: 700_000 })
      .expect(403);
    await waiter
      .post(`/v1/staff/sessions/${tableSessionId}/payments`)
      .set(idem())
      .send({ method: 'CASH', amountKobo: 700_000 })
      .expect(201);
    const tab = await waiter.get(`/v1/staff/sessions/${tableSessionId}`).expect(200);
    expect(tab.body.tab.status).toBe('PAID');
    expect(tab.body.tab.totals).toMatchObject({
      totalKobo: 1_200_000,
      paidKobo: 1_200_000,
      balanceKobo: 0,
    });
    expect(
      await ctx.raw.auditEvent.count({
        where: { action: 'PAYMENT_RECORDED', venueId: ctx.venueId },
      }),
    ).toBeGreaterThan(0);
    await waiter.post(`/v1/staff/sessions/${tableSessionId}/close`).expect(200);

    // Receipt is shareable by token.
    const receipt = await ctx
      .http()
      .get(`/v1/public/receipts/${tab.body.tab.receiptToken}`)
      .expect(200);
    expect(receipt.body.payments.map((p: { bucket: string }) => p.bucket).sort()).toEqual([
      'CASH',
      'TRANSFER',
    ]);
    expect(receipt.body.totals.totalKobo).toBe(1_200_000);
    expect(receipt.body.tabStatus).toBe('CLOSED');
  });

  it('lets only one of two simultaneous "pay full balance" requests through', async () => {
    const { a, b } = await tableWithOrder('M2', [{ name: 'Peppered Goat Meat', quantity: 2 }]);
    const results = await Promise.all([
      a.post('/v1/public/session/payments').send({ mode: 'FULL', email: 'a@example.com' }),
      b.post('/v1/public/session/payments').send({ mode: 'FULL', email: 'b@example.com' }),
    ]);
    const statuses = results.map((r) => r.status).sort();
    expect(statuses).toEqual([201, 409]);
    const loser = results.find((r) => r.status === 409)!;
    expect(loser.body.error.code).toBe('BALANCE_RESERVED');
  });

  it('flags an overpayment for refund when late confirmations exceed the balance', async () => {
    const { a, b, tableSessionId } = await tableWithOrder('M3', [
      { name: 'Beef Suya', quantity: 1 },
    ]);
    const p1 = await a
      .post('/v1/public/session/payments')
      .send({ mode: 'FULL', email: 'a@example.com' })
      .expect(201);
    // Ada's reservation expires (she left checkout open), then Bob pays the full balance too.
    await ctx.raw.payment.update({
      where: { reference: p1.body.reference },
      data: { reservedUntil: new Date(Date.now() - 1000) },
    });
    const p2 = await b
      .post('/v1/public/session/payments')
      .send({ mode: 'FULL', email: 'b@example.com' })
      .expect(201);
    // Both complete at Paystack at the same moment.
    await Promise.all([complete(p1.body.reference), complete(p2.body.reference)]);
    const tab = await waiter.get(`/v1/staff/sessions/${tableSessionId}`).expect(200);
    expect(tab.body.tab.totals).toMatchObject({
      totalKobo: 300_000,
      paidKobo: 600_000,
      balanceKobo: 0,
      overpaidKobo: 300_000,
    });
    const payments = await ctx.raw.payment.findMany({
      where: { reference: { in: [p1.body.reference, p2.body.reference] } },
    });
    expect(payments.map((p) => p.status)).toEqual(['SUCCESS', 'SUCCESS']);
    expect(payments.map((p) => p.overpaidKobo).sort()).toEqual([0, 300_000]);
    expect(
      await ctx.raw.auditEvent.count({
        where: { action: 'OVERPAYMENT_FLAGGED', venueId: ctx.venueId },
      }),
    ).toBe(1);
    // Overpaid tabs can still be closed (refund handled outside the app).
    await waiter.post(`/v1/staff/sessions/${tableSessionId}/close`).expect(200);
  });

  it('lets a customer back out of checkout, releasing the reservation', async () => {
    const { a, b } = await tableWithOrder('M4', [{ name: 'Zobo', quantity: 2 }]);
    const p1 = await a
      .post('/v1/public/session/payments')
      .send({ mode: 'FULL', email: 'a@example.com' })
      .expect(201);
    await b
      .post('/v1/public/session/payments')
      .send({ mode: 'FULL', email: 'b@example.com' })
      .expect(409);
    const cancelled = await a.post(`/v1/public/payments/${p1.body.reference}/cancel`).expect(200);
    expect(cancelled.body.status).toBe('FAILED');
    await b
      .post('/v1/public/session/payments')
      .send({ mode: 'FULL', email: 'b@example.com' })
      .expect(201);
    // Another customer cannot see or cancel someone else's payment.
    await b.post(`/v1/public/payments/${p1.body.reference}/cancel`).expect(404);
  });

  it('refuses online payment until the venue has a payout sub-account', async () => {
    const { a } = await tableWithOrder('M5', [{ name: 'Lager (bottle)', quantity: 1 }]);
    await ctx.raw.venue.update({
      where: { id: ctx.venueId },
      data: { paystackSubaccountCode: null },
    });
    try {
      const res = await a
        .post('/v1/public/session/payments')
        .send({ mode: 'FULL', email: 'a@example.com' })
        .expect(409);
      expect(res.body.error.code).toBe('ONLINE_PAYMENTS_DISABLED');
    } finally {
      await ctx.raw.venue.update({
        where: { id: ctx.venueId },
        data: { paystackSubaccountCode: 'ACCT_demo_mock' },
      });
    }
  });
});

describe('Paystack webhook handling', () => {
  it('rejects bad signatures, processes valid ones once, and stores raw events', async () => {
    const { a } = await tableWithOrder('M6', [{ name: 'Bottled Water (75cl)', quantity: 2 }]);
    const start = await a
      .post('/v1/public/session/payments')
      .send({ mode: 'FULL', email: 'w@example.com' })
      .expect(201);
    const ref = start.body.reference as string;
    const { rawBody } = mock().complete(ref, 'success', 'ussd');

    const forged = await ctx
      .http()
      .post('/v1/webhooks/paystack')
      .set('Content-Type', 'application/json')
      .set('x-paystack-signature', paystackSignature(rawBody, 'wrong-secret'))
      .send(rawBody.toString())
      .expect(401);
    expect(forged.body.error.code).toBe('FORBIDDEN');
    expect((await ctx.raw.payment.findUniqueOrThrow({ where: { reference: ref } })).status).toBe(
      'PENDING',
    );
    const stored = await ctx.raw.webhookEvent.findFirstOrThrow({ where: { reference: ref } });
    expect(stored).toMatchObject({
      signatureValid: false,
      processedAt: null,
      eventType: 'charge.success',
    });

    const good = paystackSignature(rawBody, SECRET);
    await ctx
      .http()
      .post('/v1/webhooks/paystack')
      .set('Content-Type', 'application/json')
      .set('x-paystack-signature', good)
      .send(rawBody.toString())
      .expect(200);
    const dup = await ctx
      .http()
      .post('/v1/webhooks/paystack')
      .set('Content-Type', 'application/json')
      .set('x-paystack-signature', good)
      .send(rawBody.toString())
      .expect(200);
    expect(dup.body).toEqual({ ok: true, duplicate: true });
    const payment = await ctx.raw.payment.findUniqueOrThrow({ where: { reference: ref } });
    expect(payment).toMatchObject({ status: 'SUCCESS', channel: 'ussd' });
    expect(
      await ctx.raw.auditEvent.count({
        where: { action: 'PAYMENT_CONFIRMED', entityId: payment.id },
      }),
    ).toBe(1);
    expect(await ctx.raw.webhookEvent.count({ where: { reference: ref } })).toBe(1);
  });

  it('does not mark paid from a correctly signed event if Paystack verify disagrees', async () => {
    const { a } = await tableWithOrder('T1', [{ name: 'Zobo', quantity: 1 }]);
    const start = await a
      .post('/v1/public/session/payments')
      .send({ mode: 'FULL', email: 'v@example.com' })
      .expect(201);
    const ref = start.body.reference as string;
    // A signed "charge.success" arrives, but the transaction is still pending at Paystack.
    const body = Buffer.from(
      JSON.stringify({
        event: 'charge.success',
        data: { reference: ref, amount: 150_000, status: 'success' },
      }),
    );
    await ctx
      .http()
      .post('/v1/webhooks/paystack')
      .set('Content-Type', 'application/json')
      .set('x-paystack-signature', paystackSignature(body, SECRET))
      .send(body.toString())
      .expect(200);
    expect((await ctx.raw.payment.findUniqueOrThrow({ where: { reference: ref } })).status).toBe(
      'PENDING',
    );
  });

  it('acknowledges events for unknown references (other integrations on the account)', async () => {
    const body = Buffer.from(
      JSON.stringify({ event: 'charge.success', data: { reference: 'not-ours-123456' } }),
    );
    await ctx
      .http()
      .post('/v1/webhooks/paystack')
      .set('Content-Type', 'application/json')
      .set('x-paystack-signature', paystackSignature(body, SECRET))
      .send(body.toString())
      .expect(200);
    const ev = await ctx.raw.webhookEvent.findFirstOrThrow({
      where: { reference: 'not-ours-123456' },
    });
    expect(ev.processingError).toBe('unknown reference');
  });
});

describe('reconciliation', () => {
  it('confirms a pending payment Paystack has settled even if the webhook never arrived', async () => {
    const { a, tableSessionId } = await tableWithOrder('T2', [{ name: 'Chapman', quantity: 1 }]);
    const start = await a
      .post('/v1/public/session/payments')
      .send({ mode: 'FULL', email: 'r@example.com' })
      .expect(201);
    const ref = start.body.reference as string;
    mock().complete(ref, 'success'); // paid at Paystack, webhook lost
    const service = ctx.app.get(PaymentsService);
    const early = await service.reconcile(new Date());
    expect(early.checked).toBe(0); // younger than RECONCILE_AFTER_MINUTES
    const later = await service.reconcile(new Date(Date.now() + 5 * 60_000));
    // Other tests' unfinished checkouts are re-checked too, but only this one is paid at Paystack.
    expect(later.confirmed).toBe(1);
    expect(later.checked).toBeGreaterThanOrEqual(1);
    expect((await ctx.raw.payment.findUniqueOrThrow({ where: { reference: ref } })).status).toBe(
      'SUCCESS',
    );
    const tab = await waiter.get(`/v1/staff/sessions/${tableSessionId}`).expect(200);
    expect(tab.body.tab.status).toBe('PAID');
  });

  it('marks long-abandoned checkouts as failed', async () => {
    const { a } = await tableWithOrder('T3', [{ name: 'Chapman', quantity: 1 }]);
    const start = await a
      .post('/v1/public/session/payments')
      .send({ mode: 'FULL', email: 'r@example.com' })
      .expect(201);
    const service = ctx.app.get(PaymentsService);
    await service.reconcile(new Date(Date.now() + 2 * 3600_000));
    const p = await ctx.raw.payment.findUniqueOrThrow({
      where: { reference: start.body.reference },
    });
    expect(p).toMatchObject({ status: 'FAILED', failureReason: 'abandoned' });
  });
});

describe('PREPAY venues', () => {
  it('holds orders until paid, then releases them to the stations', async () => {
    const owner = await loginOwner(ctx);
    await owner.patch('/v1/admin/venue').send({ paymentMode: 'PREPAY' }).expect(200);
    try {
      const { a, order, tableSessionId } = await tableWithOrder('T4', [
        { name: 'Fried Rice', quantity: 1 },
      ]);
      expect(order.status).toBe('AWAITING_PAYMENT');
      expect(order.amountDueKobo).toBe(350_000);
      const kitchen = await ctx.raw.station.findFirstOrThrow({
        where: { venueId: ctx.venueId, name: 'Kitchen' },
      });
      const before = await station.get(`/v1/staff/stations/${kitchen.id}/queue`).expect(200);
      expect(before.body.items.some((i: { orderId: string }) => i.orderId === order.id)).toBe(
        false,
      );
      let tab = await a.get('/v1/public/session').expect(200);
      expect(tab.body.tab.totals.totalKobo).toBe(0);

      const start = await a
        .post('/v1/public/session/payments')
        .send({ mode: 'ORDER', orderId: order.id, email: 'p@example.com' })
        .expect(201);
      expect(start.body.amountKobo).toBe(350_000);
      await complete(start.body.reference);
      const after = await station.get(`/v1/staff/stations/${kitchen.id}/queue`).expect(200);
      expect(after.body.items.some((i: { orderId: string }) => i.orderId === order.id)).toBe(true);
      tab = await a.get('/v1/public/session').expect(200);
      expect(tab.body.tab.orders[0].status).toBe('PLACED');
      expect(tab.body.tab.totals).toMatchObject({
        totalKobo: 350_000,
        paidKobo: 350_000,
        balanceKobo: 0,
      });

      // Paid item turns out unavailable: the venue owes a refund (flagged as overpaid).
      const item = after.body.items.find((i: { orderId: string }) => i.orderId === order.id);
      await station
        .post(`/v1/staff/order-items/${item.id}/unavailable`)
        .send({ disableMenuItem: false })
        .expect(200);
      tab = await a.get('/v1/public/session').expect(200);
      expect(tab.body.tab.totals.overpaidKobo).toBe(350_000);

      // Cash can settle a held order too.
      const zobo = await menuItem(ctx, 'Zobo');
      const o2 = await a
        .post('/v1/public/session/orders')
        .send({ items: [{ menuItemId: zobo.id, quantity: 1 }] })
        .expect(201);
      await waiter
        .post(`/v1/staff/sessions/${tableSessionId}/payments`)
        .send({ method: 'POS', amountKobo: 1, orderId: o2.body.id })
        .expect(400);
      await waiter
        .post(`/v1/staff/sessions/${tableSessionId}/payments`)
        .send({ method: 'POS', amountKobo: 150_000, orderId: o2.body.id })
        .expect(201);
      tab = await a.get('/v1/public/session').expect(200);
      expect(tab.body.tab.orders[1].status).toBe('PLACED');

      // Unpaid held orders expire.
      const o3 = await a
        .post('/v1/public/session/orders')
        .send({ items: [{ menuItemId: zobo.id, quantity: 1 }] })
        .expect(201);
      await ctx.app.get(PaymentsService).expirePrepayOrders(new Date(Date.now() + 31 * 60_000));
      expect((await ctx.raw.order.findUniqueOrThrow({ where: { id: o3.body.id } })).status).toBe(
        'CANCELLED',
      );
    } finally {
      await owner.patch('/v1/admin/venue').send({ paymentMode: 'POSTPAY' }).expect(200);
    }
  });
});

describe('payout onboarding', () => {
  it('lets the owner resolve the account name and create a sub-account', async () => {
    const owner = await loginOwner(ctx);
    const banks = await owner.get('/v1/admin/payout/banks').expect(200);
    expect(banks.body.some((b: { code: string }) => b.code === '058')).toBe(true);
    const resolved = await owner
      .post('/v1/admin/payout/resolve')
      .send({ bankCode: '058', accountNumber: '0123456789' })
      .expect(200);
    expect(resolved.body.accountName).toBe('MOCK ACCOUNT 058-6789');
    const bad = await owner
      .post('/v1/admin/payout/resolve')
      .send({ bankCode: '058', accountNumber: '123' })
      .expect(400);
    expect(bad.body.error.code).toBe('VALIDATION_FAILED');
    const res = await owner
      .post('/v1/admin/payout')
      .send({ bankCode: '058', bankName: 'Guaranty Trust Bank', accountNumber: '0123456789' })
      .expect(200);
    expect(res.body.subaccountCode).toMatch(/^ACCT_mock_/);
    const venue = await owner.get('/v1/admin/venue').expect(200);
    expect(venue.body.payout).toMatchObject({
      configured: true,
      accountNumberMasked: '******6789',
      accountName: 'MOCK ACCOUNT 058-6789',
    });
    expect(
      await ctx.raw.auditEvent.count({
        where: { action: 'PAYOUT_CONFIGURED', venueId: ctx.venueId },
      }),
    ).toBe(1);
  });

  it('is owner-only', async () => {
    const manager = await loginManager(ctx);
    await manager.get('/v1/admin/payout/banks').expect(403);
    await manager
      .post('/v1/admin/payout')
      .send({ bankCode: '058', bankName: 'GTB', accountNumber: '0123456789' })
      .expect(403);
  });
});
