import {
  addKobo,
  applyBps,
  assertKobo,
  BPS_DENOMINATOR,
  mulDivHalfUp,
  mulKobo,
  type Kobo,
} from './money';

/**
 * The one function that turns a tab's lines, discounts and venue charge settings into totals.
 *
 * Order of application: subtotal → discounts → service charge → VAT → total.
 * - Exclusive pricing: service charge = SC% of discounted subtotal; VAT = VAT% of
 *   (discounted subtotal + service charge).
 * - Inclusive pricing (menu prices already include VAT): the VAT inside the discounted
 *   subtotal is backed out; service charge is computed on the net-of-VAT amount and VAT is
 *   added on the service charge only. Item VAT is reported as "included".
 * Each charge is rounded once (half-up), so the breakdown always sums exactly to the total.
 */

export interface TabLineInput {
  id: string;
  /** Snapshot unit price including add-ons. */
  unitPriceKobo: Kobo;
  quantity: number;
  /** false for UNAVAILABLE / VOIDED items and for items on unpaid prepay orders. */
  billable: boolean;
}

export interface TabDiscountInput {
  id: string;
  kind: 'AMOUNT' | 'PERCENT';
  /** For AMOUNT discounts. */
  amountKobo?: Kobo | null;
  /** For PERCENT discounts, in basis points (1000 = 10%). */
  percentBps?: number | null;
  /** Item-level discount when set; whole-tab discount otherwise. */
  orderItemId?: string | null;
}

export interface TabChargeSettings {
  vatBps: number;
  serviceChargeBps: number;
  pricesIncludeVat: boolean;
}

export interface TabLineTotals {
  id: string;
  grossKobo: Kobo;
  discountKobo: Kobo;
  netKobo: Kobo;
  billable: boolean;
}

export interface TabTotals {
  lines: TabLineTotals[];
  discounts: { id: string; appliedKobo: Kobo }[];
  /** Sum of billable lines at menu prices. */
  subtotalKobo: Kobo;
  discountKobo: Kobo;
  /** Subtotal after discounts (still VAT-inclusive when prices include VAT). */
  discountedSubtotalKobo: Kobo;
  serviceChargeKobo: Kobo;
  /** All VAT on the tab, including VAT already inside inclusive prices. */
  vatKobo: Kobo;
  /** Part of vatKobo already included in menu prices (0 for exclusive pricing). */
  vatIncludedKobo: Kobo;
  totalKobo: Kobo;
  pricesIncludeVat: boolean;
}

function validateSettings(s: TabChargeSettings): void {
  for (const [name, v] of [
    ['vatBps', s.vatBps],
    ['serviceChargeBps', s.serviceChargeBps],
  ] as const) {
    if (!Number.isSafeInteger(v) || v < 0 || v > BPS_DENOMINATOR) {
      throw new RangeError(`${name} must be an integer between 0 and ${BPS_DENOMINATOR}`);
    }
  }
}

function discountAmount(d: TabDiscountInput, base: Kobo): Kobo {
  if (base <= 0) return 0;
  if (d.kind === 'PERCENT') {
    const bps = d.percentBps ?? 0;
    if (!Number.isSafeInteger(bps) || bps < 0 || bps > BPS_DENOMINATOR) {
      throw new RangeError('percentBps must be between 0 and 10000');
    }
    return Math.min(base, applyBps(base, bps));
  }
  const amount = d.amountKobo ?? 0;
  assertKobo(amount, 'discount amount');
  if (amount < 0) throw new RangeError('discount amount must be non-negative');
  return Math.min(base, amount);
}

export function calculateTab(
  lines: readonly TabLineInput[],
  discounts: readonly TabDiscountInput[],
  settings: TabChargeSettings,
): TabTotals {
  validateSettings(settings);

  const lineTotals: TabLineTotals[] = lines.map((l) => {
    assertKobo(l.unitPriceKobo, 'unit price');
    if (l.unitPriceKobo < 0) throw new RangeError('unit price must be non-negative');
    if (!Number.isSafeInteger(l.quantity) || l.quantity <= 0) {
      throw new RangeError('quantity must be a positive integer');
    }
    const gross = l.billable ? mulKobo(l.unitPriceKobo, l.quantity) : 0;
    return { id: l.id, grossKobo: gross, discountKobo: 0, netKobo: gross, billable: l.billable };
  });
  const byId = new Map(lineTotals.map((l) => [l.id, l]));
  const applied: { id: string; appliedKobo: Kobo }[] = [];

  // 1. Item-level discounts, capped at what is left on the line.
  for (const d of discounts) {
    if (!d.orderItemId) continue;
    const line = byId.get(d.orderItemId);
    const amount = line && line.billable ? discountAmount(d, line.netKobo) : 0;
    if (line) {
      line.discountKobo += amount;
      line.netKobo -= amount;
    }
    applied.push({ id: d.id, appliedKobo: amount });
  }

  const subtotal = addKobo(0, ...lineTotals.map((l) => l.grossKobo));
  let remaining = addKobo(0, ...lineTotals.map((l) => l.netKobo));

  // 2. Whole-tab discounts, in the order given, on what remains.
  for (const d of discounts) {
    if (d.orderItemId) continue;
    const amount = discountAmount(d, remaining);
    remaining -= amount;
    applied.push({ id: d.id, appliedKobo: amount });
  }

  const discounted = remaining;
  const discountTotal = subtotal - discounted;

  let serviceCharge: Kobo;
  let vat: Kobo;
  let vatIncluded: Kobo;
  let total: Kobo;

  if (settings.pricesIncludeVat) {
    const netOfVat = mulDivHalfUp(discounted, BPS_DENOMINATOR, BPS_DENOMINATOR + settings.vatBps);
    vatIncluded = discounted - netOfVat;
    serviceCharge = applyBps(netOfVat, settings.serviceChargeBps);
    const serviceChargeVat = applyBps(serviceCharge, settings.vatBps);
    vat = vatIncluded + serviceChargeVat;
    total = addKobo(discounted, serviceCharge, serviceChargeVat);
  } else {
    vatIncluded = 0;
    serviceCharge = applyBps(discounted, settings.serviceChargeBps);
    vat = applyBps(discounted + serviceCharge, settings.vatBps);
    total = addKobo(discounted, serviceCharge, vat);
  }

  // Keep discounts in input order for display.
  const order = new Map(discounts.map((d, i) => [d.id, i]));
  applied.sort((a, b) => (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0));

  return {
    lines: lineTotals,
    discounts: applied,
    subtotalKobo: subtotal,
    discountKobo: discountTotal,
    discountedSubtotalKobo: discounted,
    serviceChargeKobo: serviceCharge,
    vatKobo: vat,
    vatIncludedKobo: vatIncluded,
    totalKobo: total,
    pricesIncludeVat: settings.pricesIncludeVat,
  };
}

export interface TabBalance {
  totalKobo: Kobo;
  paidKobo: Kobo;
  balanceKobo: Kobo;
  overpaidKobo: Kobo;
}

export function tabBalance(totalKobo: Kobo, paidKobo: Kobo): TabBalance {
  assertKobo(totalKobo);
  assertKobo(paidKobo);
  return {
    totalKobo,
    paidKobo,
    balanceKobo: Math.max(0, totalKobo - paidKobo),
    overpaidKobo: Math.max(0, paidKobo - totalKobo),
  };
}

/** Unit price of an order line: base price plus the add-on deltas chosen. */
export function unitPriceWithAddOns(basePriceKobo: Kobo, addOnDeltasKobo: readonly Kobo[]): Kobo {
  return addKobo(basePriceKobo, ...addOnDeltasKobo);
}
