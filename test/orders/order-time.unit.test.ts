import { describe, expect, it } from 'vitest';
import { formatUtcTimestamp } from '../../src/orders/domain/order-time.js';

describe('formatUtcTimestamp', () => {
  it('formats UTC calendar without a zone suffix', () => {
    expect(
      formatUtcTimestamp(new Date('2026-10-28T18:30:45.123Z')),
    ).toBe('2026-10-28T18:30:45.123');
  });

  it('converts an offset date to UTC', () => {
    expect(
      formatUtcTimestamp(new Date('2026-10-28T15:30:45.123-03:00')),
    ).toBe('2026-10-28T18:30:45.123');
  });

  it('keeps the UTC date across local midnight boundaries', () => {
    expect(
      formatUtcTimestamp(new Date('2026-10-29T01:00:00.000Z')),
    ).toBe('2026-10-29T01:00:00.000');
  });

  it('rejects an invalid date instead of inventing a timestamp', () => {
    expect(() => formatUtcTimestamp(new Date(Number.NaN))).toThrow(
      RangeError,
    );
  });
});
