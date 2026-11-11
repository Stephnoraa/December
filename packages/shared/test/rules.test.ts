import { describe, expect, it } from 'vitest';
import {
  assertOrderItemTransition,
  assertTableSessionTransition,
  canOrderInSession,
  canTransitionOrderItem,
  deriveTabStatus,
  InvalidTransitionError,
  isBillableItemStatus,
} from '../src/state-machines';
import {
  canApproveAdjustments,
  canManageRole,
  canUsePasswordLogin,
  hasPermission,
  homeRouteForRole,
  Permission,
} from '../src/permissions';
import { paymentBucket } from '../src/enums';
import { businessDayStart, elapsedLabel } from '../src/time';

describe('order item state machine', () => {
  it('allows the happy path', () => {
    expect(canTransitionOrderItem('SENT', 'ACCEPTED')).toBe(true);
    expect(canTransitionOrderItem('ACCEPTED', 'READY')).toBe(true);
    expect(canTransitionOrderItem('READY', 'SERVED')).toBe(true);
  });
  it('allows unavailable from SENT only, with undo back to SENT', () => {
    expect(canTransitionOrderItem('SENT', 'UNAVAILABLE')).toBe(true);
    expect(canTransitionOrderItem('ACCEPTED', 'UNAVAILABLE')).toBe(false);
    expect(canTransitionOrderItem('UNAVAILABLE', 'SENT')).toBe(true);
    expect(canTransitionOrderItem('UNAVAILABLE', 'ACCEPTED')).toBe(false);
  });
  it('allows voids from billable states only', () => {
    for (const s of ['SENT', 'ACCEPTED', 'READY', 'SERVED'] as const) {
      expect(canTransitionOrderItem(s, 'VOIDED')).toBe(true);
    }
    expect(canTransitionOrderItem('UNAVAILABLE', 'VOIDED')).toBe(false);
    expect(canTransitionOrderItem('VOIDED', 'SENT')).toBe(false);
  });
  it('rejects skipping steps', () => {
    expect(() => assertOrderItemTransition('SENT', 'READY')).toThrow(InvalidTransitionError);
    expect(() => assertOrderItemTransition('SENT', 'SERVED')).toThrow(InvalidTransitionError);
    expect(() => assertOrderItemTransition('SERVED', 'READY')).toThrow(InvalidTransitionError);
  });
  it('knows which statuses are billable', () => {
    expect(isBillableItemStatus('SERVED')).toBe(true);
    expect(isBillableItemStatus('UNAVAILABLE')).toBe(false);
    expect(isBillableItemStatus('VOIDED')).toBe(false);
  });
});

describe('table session state machine', () => {
  it('opens and closes once', () => {
    expect(() => assertTableSessionTransition('OPEN', 'CLOSED')).not.toThrow();
    expect(() => assertTableSessionTransition('CLOSED', 'OPEN')).toThrow(InvalidTransitionError);
    expect(() => assertTableSessionTransition('OPEN', 'OPEN')).toThrow(InvalidTransitionError);
  });
  it('only allows ordering in open sessions', () => {
    expect(canOrderInSession('OPEN')).toBe(true);
    expect(canOrderInSession('AWAITING_OPEN')).toBe(false);
    expect(canOrderInSession('CLOSED')).toBe(false);
    expect(canOrderInSession(null)).toBe(false);
  });
});

describe('tab status', () => {
  it('is PAID only when something is owed and fully paid', () => {
    expect(deriveTabStatus('OPEN', 0, 0)).toBe('OPEN');
    expect(deriveTabStatus('OPEN', 1000, 999)).toBe('OPEN');
    expect(deriveTabStatus('OPEN', 1000, 1000)).toBe('PAID');
    expect(deriveTabStatus('PAID', 1500, 1000)).toBe('OPEN');
    expect(deriveTabStatus('CLOSED', 1500, 0)).toBe('CLOSED');
  });
});

describe('permissions', () => {
  it('limits waiters and station staff', () => {
    expect(hasPermission('WAITER', Permission.FLOOR_OPERATE)).toBe(true);
    expect(hasPermission('WAITER', Permission.PAYMENTS_RECORD)).toBe(true);
    expect(hasPermission('WAITER', Permission.MENU_MANAGE)).toBe(false);
    expect(hasPermission('WAITER', Permission.ADJUSTMENTS_APPROVE)).toBe(false);
    expect(hasPermission('STATION', Permission.STATION_OPERATE)).toBe(true);
    expect(hasPermission('STATION', Permission.FLOOR_OPERATE)).toBe(false);
  });
  it('lets only owners configure payouts and manage owners', () => {
    expect(hasPermission('OWNER', Permission.VENUE_PAYOUT)).toBe(true);
    expect(hasPermission('MANAGER', Permission.VENUE_PAYOUT)).toBe(false);
    expect(canManageRole('MANAGER', 'WAITER')).toBe(true);
    expect(canManageRole('MANAGER', 'OWNER')).toBe(false);
    expect(canManageRole('OWNER', 'OWNER')).toBe(true);
    expect(canManageRole('WAITER', 'WAITER')).toBe(false);
  });
  it('lets managers and owners approve and use passwords', () => {
    expect(canApproveAdjustments('MANAGER')).toBe(true);
    expect(canApproveAdjustments('OWNER')).toBe(true);
    expect(canApproveAdjustments('WAITER')).toBe(false);
    expect(canApproveAdjustments('STATION')).toBe(false);
    expect(canUsePasswordLogin('MANAGER')).toBe(true);
    expect(canUsePasswordLogin('WAITER')).toBe(false);
  });
  it('routes each role home', () => {
    expect(homeRouteForRole('STATION')).toBe('/station');
    expect(homeRouteForRole('WAITER')).toBe('/floor');
    expect(homeRouteForRole('OWNER')).toBe('/dashboard');
  });
});

describe('payment buckets', () => {
  it('groups by method and Paystack channel', () => {
    expect(paymentBucket('CASH', null)).toBe('CASH');
    expect(paymentBucket('POS', null)).toBe('POS');
    expect(paymentBucket('PAYSTACK', 'card')).toBe('CARD');
    expect(paymentBucket('PAYSTACK', 'bank_transfer')).toBe('TRANSFER');
    expect(paymentBucket('PAYSTACK', 'ussd')).toBe('USSD');
    expect(paymentBucket('PAYSTACK', 'qr')).toBe('OTHER_ONLINE');
  });
});

describe('time helpers', () => {
  it('starts the business day at 06:00 Lagos (05:00 UTC)', () => {
    expect(businessDayStart(new Date('2026-12-20T20:00:00Z')).toISOString()).toBe(
      '2026-12-20T05:00:00.000Z',
    );
    // 02:00 Lagos on the 21st still belongs to the 20th's trading day
    expect(businessDayStart(new Date('2026-12-21T01:00:00Z')).toISOString()).toBe(
      '2026-12-20T05:00:00.000Z',
    );
    expect(businessDayStart(new Date('2026-12-21T05:00:00Z')).toISOString()).toBe(
      '2026-12-21T05:00:00.000Z',
    );
  });
  it('labels elapsed time', () => {
    const now = new Date('2026-12-20T20:00:00Z');
    expect(elapsedLabel('2026-12-20T19:57:00Z', now)).toBe('3m');
    expect(elapsedLabel('2026-12-20T18:55:00Z', now)).toBe('1h 05m');
  });
});

describe('request schemas', () => {
  it('parses every adjustment shape', async () => {
    const { adjustmentSchema } = await import('../src/schemas');
    const approver = { staffId: '01890000-0000-7000-8000-000000000000', pin: '1234' };
    expect(
      adjustmentSchema.parse({
        type: 'VOID',
        orderItemId: approver.staffId,
        reason: 'Spilled',
        approver,
      }).type,
    ).toBe('VOID');
    expect(
      adjustmentSchema.parse({
        type: 'DISCOUNT',
        kind: 'AMOUNT',
        amountKobo: 500,
        reason: 'Late',
        approver,
      }),
    ).toMatchObject({ kind: 'AMOUNT' });
    expect(
      adjustmentSchema.parse({
        type: 'DISCOUNT',
        kind: 'PERCENT',
        percentBps: 1000,
        reason: 'Regular',
        approver,
      }),
    ).toMatchObject({ kind: 'PERCENT' });
    expect(
      adjustmentSchema.safeParse({
        type: 'DISCOUNT',
        kind: 'PERCENT',
        percentBps: 20_000,
        reason: 'Too much',
        approver,
      }).success,
    ).toBe(false);
    expect(adjustmentSchema.safeParse({ type: 'VOID', reason: 'No item', approver }).success).toBe(
      false,
    );
  });
});
