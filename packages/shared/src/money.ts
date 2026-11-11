/**
 * Money utilities. All amounts are integers in kobo (1 NGN = 100 kobo).
 * Never use floating point for money: arithmetic here uses integers and BigInt.
 */

export type Kobo = number;

export const CURRENCY = 'NGN' as const;
export const BPS_DENOMINATOR = 10_000;

export class MoneyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'MoneyError';
  }
}

export function assertKobo(value: number, label = 'amount'): asserts value is Kobo {
  if (!Number.isSafeInteger(value)) {
    throw new MoneyError(`${label} must be an integer number of kobo, got ${String(value)}`);
  }
}

export function addKobo(...values: Kobo[]): Kobo {
  let total = 0;
  for (const v of values) {
    assertKobo(v);
    total += v;
  }
  assertKobo(total, 'sum');
  return total;
}

export function subKobo(a: Kobo, b: Kobo): Kobo {
  assertKobo(a);
  assertKobo(b);
  const r = a - b;
  assertKobo(r, 'difference');
  return r;
}

export function mulKobo(value: Kobo, quantity: number): Kobo {
  assertKobo(value);
  if (!Number.isSafeInteger(quantity)) throw new MoneyError('quantity must be an integer');
  const r = value * quantity;
  assertKobo(r, 'product');
  return r;
}

/**
 * value * numerator / denominator, rounded half-up (half away from zero for negatives),
 * computed exactly with BigInt.
 */
export function mulDivHalfUp(value: number, numerator: number, denominator: number): number {
  assertKobo(value, 'value');
  if (!Number.isSafeInteger(numerator) || !Number.isSafeInteger(denominator) || denominator === 0) {
    throw new MoneyError('numerator and denominator must be integers and denominator non-zero');
  }
  let n = BigInt(value) * BigInt(numerator);
  let d = BigInt(denominator);
  if (d < 0n) {
    n = -n;
    d = -d;
  }
  const negative = n < 0n;
  const absN = negative ? -n : n;
  let q = absN / d;
  const r = absN % d;
  if (r * 2n >= d) q += 1n;
  const result = Number(negative ? -q : q);
  assertKobo(result, 'result');
  return result;
}

/** Applies a rate in basis points (750 = 7.5%) to an amount, rounding half-up. */
export function applyBps(value: Kobo, bps: number): Kobo {
  return mulDivHalfUp(value, bps, BPS_DENOMINATOR);
}

/** Splits `total` into `parts` integer shares that sum exactly to `total`. */
export function splitEvenly(total: Kobo, parts: number): Kobo[] {
  assertKobo(total);
  if (!Number.isSafeInteger(parts) || parts <= 0) throw new MoneyError('parts must be positive');
  const base = Math.trunc(total / parts);
  const remainder = total - base * parts;
  return Array.from({ length: parts }, (_, i) => base + (i < remainder ? 1 : 0));
}

const wholeFormatter = new Intl.NumberFormat('en-NG', {
  style: 'currency',
  currency: CURRENCY,
  minimumFractionDigits: 0,
  maximumFractionDigits: 0,
});

/** Formats kobo as Naira, e.g. 150050 → "₦1,500.50". Exact (string based, no floats). */
export function formatNaira(kobo: Kobo, opts: { hideZeroKobo?: boolean } = {}): string {
  assertKobo(kobo);
  const negative = kobo < 0;
  const abs = BigInt(Math.abs(kobo));
  const whole = abs / 100n;
  const fraction = (abs % 100n).toString().padStart(2, '0');
  const wholeText = wholeFormatter.format(whole);
  const text = opts.hideZeroKobo && fraction === '00' ? wholeText : `${wholeText}.${fraction}`;
  return negative ? `-${text}` : text;
}

/**
 * Parses a Naira amount typed by a person ("1500", "1,500.5", "₦2,000.00") into kobo.
 * Returns null when the text is not a valid non-negative amount with at most 2 decimals.
 */
export function parseNairaToKobo(input: string): Kobo | null {
  const cleaned = input.replace(/[₦,\s]/g, '').replace(/^NGN/i, '');
  const match = /^(\d{1,12})(?:\.(\d{1,2}))?$/.exec(cleaned);
  if (!match) return null;
  const whole = match[1] ?? '0';
  const frac = (match[2] ?? '').padEnd(2, '0');
  const kobo = Number(whole) * 100 + Number(frac);
  return Number.isSafeInteger(kobo) ? kobo : null;
}

/** Converts kobo to a plain decimal string for inputs, e.g. 150050 → "1500.50". */
export function koboToNairaInput(kobo: Kobo): string {
  assertKobo(kobo);
  const abs = Math.abs(kobo);
  const text = `${Math.trunc(abs / 100)}.${String(abs % 100).padStart(2, '0')}`;
  return kobo < 0 ? `-${text}` : text;
}
