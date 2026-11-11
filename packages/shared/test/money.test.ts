import { describe, expect, it } from 'vitest';
import {
  addKobo,
  applyBps,
  formatNaira,
  koboToNairaInput,
  MoneyError,
  mulDivHalfUp,
  mulKobo,
  parseNairaToKobo,
  splitEvenly,
  subKobo,
} from '../src/money';

describe('money', () => {
  it('adds and subtracts integer kobo', () => {
    expect(addKobo(100, 250, 5)).toBe(355);
    expect(addKobo()).toBe(0);
    expect(subKobo(1000, 1)).toBe(999);
    expect(mulKobo(150_000, 3)).toBe(450_000);
  });

  it('rejects floats and unsafe integers', () => {
    expect(() => addKobo(1.5)).toThrow(MoneyError);
    expect(() => mulKobo(100, 1.2)).toThrow(MoneyError);
    expect(() => addKobo(Number.MAX_SAFE_INTEGER, 1)).toThrow(MoneyError);
    expect(() => mulDivHalfUp(1, 1, 0)).toThrow(MoneyError);
  });

  it('rounds half-up exactly', () => {
    expect(mulDivHalfUp(5, 1, 2)).toBe(3); // 2.5 → 3
    expect(mulDivHalfUp(7, 1, 2)).toBe(4); // 3.5 → 4
    expect(mulDivHalfUp(4, 1, 3)).toBe(1); // 1.33 → 1
    expect(mulDivHalfUp(5, 1, 3)).toBe(2); // 1.67 → 2
    expect(mulDivHalfUp(-5, 1, 2)).toBe(-3); // symmetric for negatives
    expect(mulDivHalfUp(5, 1, -2)).toBe(-3);
  });

  it('applies basis points', () => {
    expect(applyBps(100_000, 750)).toBe(7_500); // 7.5% of ₦1,000
    expect(applyBps(1, 5000)).toBe(1); // 0.5 kobo → 1
    expect(applyBps(1, 4999)).toBe(0);
    expect(applyBps(123_456, 750)).toBe(9_259); // 9259.2
  });

  it('splits evenly with the remainder spread over the first shares', () => {
    expect(splitEvenly(1000, 3)).toEqual([334, 333, 333]);
    expect(splitEvenly(1000, 3).reduce((a, b) => a + b, 0)).toBe(1000);
    expect(splitEvenly(0, 2)).toEqual([0, 0]);
    expect(() => splitEvenly(100, 0)).toThrow(MoneyError);
  });

  it('formats naira for en-NG', () => {
    expect(formatNaira(150_050)).toBe('₦1,500.50');
    expect(formatNaira(0)).toBe('₦0.00');
    expect(formatNaira(5)).toBe('₦0.05');
    expect(formatNaira(-250_000)).toBe('-₦2,500.00');
    expect(formatNaira(100_000_000_00)).toBe('₦100,000,000.00');
    expect(formatNaira(250_000, { hideZeroKobo: true })).toBe('₦2,500');
  });

  it('parses typed naira amounts into kobo', () => {
    expect(parseNairaToKobo('1500')).toBe(150_000);
    expect(parseNairaToKobo('1,500.5')).toBe(150_050);
    expect(parseNairaToKobo('₦2,000.00')).toBe(200_000);
    expect(parseNairaToKobo('0.07')).toBe(7);
    expect(parseNairaToKobo('1.234')).toBeNull();
    expect(parseNairaToKobo('-5')).toBeNull();
    expect(parseNairaToKobo('abc')).toBeNull();
    expect(parseNairaToKobo('')).toBeNull();
  });

  it('round-trips kobo to input text', () => {
    expect(koboToNairaInput(150_050)).toBe('1500.50');
    expect(koboToNairaInput(5)).toBe('0.05');
    expect(parseNairaToKobo(koboToNairaInput(987_654))).toBe(987_654);
  });
});
