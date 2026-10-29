import { describe, expect, it } from 'vitest';
import {
  createOrderIntent,
  type OrderIntent,
  type OrderIntentInput,
} from '../../src/orders/domain/order-intent.js';
import {
  MAX_ORDER_SIZE,
  resolveOrderSize,
} from '../../src/orders/domain/order-quantity.js';

function intent(overrides: Partial<OrderIntentInput> = {}): OrderIntent {
  return createOrderIntent({
    instrumentId: 47,
    side: 'BUY',
    type: 'MARKET',
    size: '10',
    ...overrides,
  });
}

describe('resolveOrderSize', () => {
  it('preserves an explicit representable size', () => {
    expect(resolveOrderSize(intent({ size: '1' }), '999999.99')).toBe(1);
    expect(resolveOrderSize(intent({ size: '10' }), '999999.99')).toBe(10);
    expect(
      resolveOrderSize(intent({ size: String(MAX_ORDER_SIZE) }), '1'),
    ).toBe(MAX_ORDER_SIZE);
  });

  it('rejects explicit sizes outside the persisted INT range', () => {
    expect(
      resolveOrderSize(intent({ size: String(MAX_ORDER_SIZE + 1) }), '1'),
    ).toBeNull();
    expect(
      resolveOrderSize(
        intent({ size: '999999999999999999999999999999' }),
        '1',
      ),
    ).toBeNull();
  });

  it('floors amount divided by price exactly', () => {
    expect(
      resolveOrderSize(
        intent({ size: null, amount: '1000' }),
        '300',
      ),
    ).toBe(3);
    expect(
      resolveOrderSize(
        intent({ size: null, amount: '9.99' }),
        '0.03',
      ),
    ).toBe(333);
    expect(
      resolveOrderSize(
        intent({ size: null, amount: '0.29' }),
        '0.07',
      ),
    ).toBe(4);
  });

  it('avoids binary floating-point and intermediate rounding at the floor boundary', () => {
    expect(
      resolveOrderSize(
        intent({ size: null, amount: '0.30' }),
        '0.10',
      ),
    ).toBe(3);
    expect(
      resolveOrderSize(
        intent({ size: null, amount: '1999999.97' }),
        '999999.99',
      ),
    ).toBe(1);
    expect(
      resolveOrderSize(
        intent({ size: null, amount: '9.98' }),
        '9.99',
      ),
    ).toBeNull();
  });

  it('returns zero as a non-representable quantity', () => {
    expect(
      resolveOrderSize(
        intent({ size: null, amount: '0.01' }),
        '1',
      ),
    ).toBeNull();
    expect(
      resolveOrderSize(
        intent({ size: null, amount: '5' }),
        '10',
      ),
    ).toBeNull();
  });

  it('rejects amount conversions outside the persisted INT range', () => {
    expect(
      resolveOrderSize(
        intent({ size: null, amount: '21474836.47' }),
        '0.01',
      ),
    ).toBe(MAX_ORDER_SIZE);
    expect(
      resolveOrderSize(
        intent({ size: null, amount: '21474836.48' }),
        '0.01',
      ),
    ).toBeNull();
    expect(
      resolveOrderSize(
        intent({ size: null, amount: '999999999999999999999.99' }),
        '0.01',
      ),
    ).toBeNull();
  });

  it('returns null when the price cannot divide the amount', () => {
    expect(
      resolveOrderSize(
        intent({ size: null, amount: '10' }),
        '0',
      ),
    ).toBeNull();
    expect(
      resolveOrderSize(
        intent({ size: null, amount: '10' }),
        '-1',
      ),
    ).toBeNull();
    expect(
      resolveOrderSize(
        intent({ size: null, amount: '10' }),
        'not-a-price',
      ),
    ).toBeNull();
  });
});
