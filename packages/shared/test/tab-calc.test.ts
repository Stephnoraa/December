import { describe, expect, it } from 'vitest';
import { calculateTab, tabBalance, unitPriceWithAddOns, type TabLineInput } from '../src/tab-calc';

const exclusive = { vatBps: 750, serviceChargeBps: 0, pricesIncludeVat: false };
const inclusive = { vatBps: 750, serviceChargeBps: 0, pricesIncludeVat: true };

const line = (id: string, unit: number, qty = 1, billable = true): TabLineInput => ({
  id,
  unitPriceKobo: unit,
  quantity: qty,
  billable,
});

describe('calculateTab', () => {
  it('returns zeros for an empty tab', () => {
    const t = calculateTab([], [], exclusive);
    expect(t.totalKobo).toBe(0);
    expect(t.subtotalKobo).toBe(0);
    expect(t.vatKobo).toBe(0);
  });

  it('adds exclusive VAT on top of the subtotal', () => {
    const t = calculateTab([line('a', 350_000), line('b', 150_000, 2)], [], exclusive);
    expect(t.subtotalKobo).toBe(650_000);
    expect(t.vatKobo).toBe(48_750);
    expect(t.vatIncludedKobo).toBe(0);
    expect(t.totalKobo).toBe(698_750);
  });

  it('backs VAT out of inclusive prices without changing the total', () => {
    const t = calculateTab([line('a', 107_500)], [], inclusive);
    expect(t.subtotalKobo).toBe(107_500);
    expect(t.vatKobo).toBe(7_500);
    expect(t.vatIncludedKobo).toBe(7_500);
    expect(t.totalKobo).toBe(107_500);
  });

  it('rounds inclusive VAT half-up and keeps the breakdown exact', () => {
    const t = calculateTab([line('a', 100_001)], [], inclusive);
    // net = 100001 / 1.075 = 93024.19 → 93024, VAT = 6977
    expect(t.vatIncludedKobo).toBe(6_977);
    expect(t.totalKobo).toBe(100_001);
  });

  it('applies service charge before VAT (exclusive): VAT is charged on the service charge', () => {
    const t = calculateTab([line('a', 1_000_000)], [], { ...exclusive, serviceChargeBps: 1000 });
    expect(t.serviceChargeKobo).toBe(100_000);
    expect(t.vatKobo).toBe(82_500); // 7.5% of 1,100,000
    expect(t.totalKobo).toBe(1_182_500);
  });

  it('computes service charge on the net-of-VAT amount for inclusive prices', () => {
    const t = calculateTab([line('a', 1_075_000)], [], { ...inclusive, serviceChargeBps: 1000 });
    expect(t.vatIncludedKobo).toBe(75_000);
    expect(t.serviceChargeKobo).toBe(100_000); // 10% of 1,000,000 net
    expect(t.vatKobo).toBe(75_000 + 7_500);
    expect(t.totalKobo).toBe(1_075_000 + 100_000 + 7_500);
  });

  it('excludes unavailable and voided lines', () => {
    const t = calculateTab([line('a', 200_000), line('b', 500_000, 1, false)], [], exclusive);
    expect(t.subtotalKobo).toBe(200_000);
    expect(t.lines.find((l) => l.id === 'b')?.grossKobo).toBe(0);
    expect(t.totalKobo).toBe(215_000);
  });

  it('applies item-level amount and percent discounts, capped at the line', () => {
    const t = calculateTab(
      [line('a', 200_000), line('b', 100_000)],
      [
        { id: 'd1', kind: 'PERCENT', percentBps: 5000, orderItemId: 'a' },
        { id: 'd2', kind: 'AMOUNT', amountKobo: 500_000, orderItemId: 'b' },
      ],
      exclusive,
    );
    expect(t.discounts).toEqual([
      { id: 'd1', appliedKobo: 100_000 },
      { id: 'd2', appliedKobo: 100_000 },
    ]);
    expect(t.discountedSubtotalKobo).toBe(100_000);
    expect(t.totalKobo).toBe(107_500);
  });

  it('applies whole-tab discounts after item discounts, in order', () => {
    const t = calculateTab(
      [line('a', 100_000), line('b', 100_000)],
      [
        { id: 'tab10', kind: 'PERCENT', percentBps: 1000 },
        { id: 'itemA', kind: 'AMOUNT', amountKobo: 20_000, orderItemId: 'a' },
        { id: 'tab5k', kind: 'AMOUNT', amountKobo: 5_000 },
      ],
      exclusive,
    );
    // item discount first: 200,000 - 20,000 = 180,000; 10% → 18,000; then 5,000
    expect(t.discounts.map((d) => d.appliedKobo)).toEqual([18_000, 20_000, 5_000]);
    expect(t.discountKobo).toBe(43_000);
    expect(t.discountedSubtotalKobo).toBe(157_000);
    expect(t.vatKobo).toBe(11_775);
    expect(t.totalKobo).toBe(168_775);
  });

  it('never discounts below zero and gives nothing for discounts on non-billable items', () => {
    const t = calculateTab(
      [line('a', 100_000), line('b', 100_000, 1, false)],
      [
        { id: 'void-target', kind: 'AMOUNT', amountKobo: 50_000, orderItemId: 'b' },
        { id: 'huge', kind: 'AMOUNT', amountKobo: 10_000_000 },
        { id: 'after', kind: 'PERCENT', percentBps: 1000 },
      ],
      exclusive,
    );
    expect(t.discounts.map((d) => d.appliedKobo)).toEqual([0, 100_000, 0]);
    expect(t.totalKobo).toBe(0);
  });

  it('handles 100% VAT-free venues and rejects invalid settings', () => {
    expect(calculateTab([line('a', 123)], [], { ...exclusive, vatBps: 0 }).totalKobo).toBe(123);
    expect(() => calculateTab([], [], { ...exclusive, vatBps: -1 })).toThrow(RangeError);
    expect(() => calculateTab([], [], { ...exclusive, serviceChargeBps: 10_001 })).toThrow(
      RangeError,
    );
    expect(() => calculateTab([line('a', 1.5)], [], exclusive)).toThrow();
    expect(() => calculateTab([line('a', 100, 0)], [], exclusive)).toThrow(RangeError);
    expect(() =>
      calculateTab([line('a', 100)], [{ id: 'x', kind: 'PERCENT', percentBps: 20_000 }], exclusive),
    ).toThrow(RangeError);
  });

  it('sums of incremental totals equal the full total (prepay per-order amounts)', () => {
    const settings = { vatBps: 750, serviceChargeBps: 1250, pricesIncludeVat: false };
    const lines = [line('a', 333_333), line('b', 177_777, 3), line('c', 99_999, 2)];
    let previous = 0;
    let paid = 0;
    for (let i = 1; i <= lines.length; i++) {
      const total = calculateTab(lines.slice(0, i), [], settings).totalKobo;
      paid += total - previous;
      previous = total;
    }
    expect(paid).toBe(calculateTab(lines, [], settings).totalKobo);
  });
});

describe('tabBalance', () => {
  it('computes balance and overpayment', () => {
    expect(tabBalance(10_000, 4_000)).toEqual({
      totalKobo: 10_000,
      paidKobo: 4_000,
      balanceKobo: 6_000,
      overpaidKobo: 0,
    });
    expect(tabBalance(10_000, 12_500).overpaidKobo).toBe(2_500);
    expect(tabBalance(10_000, 12_500).balanceKobo).toBe(0);
  });
});

describe('unitPriceWithAddOns', () => {
  it('adds add-on deltas', () => {
    expect(unitPriceWithAddOns(350_000, [50_000, 0])).toBe(400_000);
  });
});
