import { describe, expect, it } from 'vitest';
import { formatNaira } from '@app/shared';

describe('customer app shared entry', () => {
  it('formats money without pulling in zod', () => {
    expect(formatNaira(350_000)).toBe('₦3,500.00');
  });
});
