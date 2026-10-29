import { describe, expect, it } from 'vitest';
import { readPositivePrice } from '../../src/orders/domain/order-price.js';

describe('readPositivePrice', () => {
  it('canonicalizes a finite positive decimal', () => {
    expect(readPositivePrice('20.50')).toBe('20.5');
    expect(readPositivePrice('300')).toBe('300');
    expect(readPositivePrice('0.01')).toBe('0.01');
  });

  it.each([
    null,
    undefined,
    '',
    '0',
    '-1',
    'NaN',
    'Infinity',
    '-Infinity',
    'not-a-price',
    20.5,
  ])('rejects %p', (value) => {
    expect(readPositivePrice(value)).toBeNull();
  });
});
