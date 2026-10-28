import { Decimal } from 'decimal.js';
import { describe, expect, it } from 'vitest';
import {
  createOrderIntent,
  orderIntentsEqual,
  type OrderIntentInput,
} from '../../src/orders/domain/order-intent.js';
import { OrderIntentError } from '../../src/orders/domain/order-intent.error.js';

function sizeIntent(overrides: Partial<OrderIntentInput> = {}) {
  return createOrderIntent({
    instrumentId: 47,
    side: 'BUY',
    type: 'LIMIT',
    size: '10',
    amount: null,
    limitPrice: '10',
    ...overrides,
  });
}

function amountIntent(overrides: Partial<OrderIntentInput> = {}) {
  return createOrderIntent({
    instrumentId: 47,
    side: 'BUY',
    type: 'LIMIT',
    size: null,
    amount: '100',
    limitPrice: '10',
    ...overrides,
  });
}

function expectIntentError(
  action: () => unknown,
  expectedCode: string,
): void {
  try {
    action();
  } catch (error) {
    expect(error).toBeInstanceOf(OrderIntentError);
    expect(error).toMatchObject({ code: expectedCode });
    return;
  }

  throw new Error(`Expected OrderIntentError code ${expectedCode}.`);
}

describe('order intent', () => {
  it('normalizes valid decimal representations to canonical strings', () => {
    expect(sizeIntent({ size: '10.00' })).toMatchObject({
      mode: 'size',
      size: '10',
      amount: null,
      limitPrice: '10',
    });
    expect(sizeIntent({ size: '3.0', limitPrice: '10.00' })).toMatchObject({
      size: '3',
      limitPrice: '10',
    });
    expect(amountIntent({ amount: '100.10' })).toMatchObject({
      mode: 'amount',
      size: null,
      amount: '100.1',
    });
    expect(amountIntent({ amount: '100.00' })).toMatchObject({
      amount: '100',
    });
  });

  it('preserves exact large decimal values without using Number or changing global Decimal config', () => {
    const before = {
      precision: Decimal.precision,
      rounding: Decimal.rounding,
      toExpNeg: Decimal.toExpNeg,
      toExpPos: Decimal.toExpPos,
    };
    const largeAmount = '123456789012345678901234567890.12';
    const largeSize = '123456789012345678901234567890';

    const amount = amountIntent({
      type: 'MARKET',
      amount: largeAmount,
      limitPrice: null,
    });
    const size = sizeIntent({
      size: largeSize,
      type: 'MARKET',
      limitPrice: null,
    });

    expect(amount.amount).toBe(largeAmount);
    expect(size.size).toBe(largeSize);
    expect(Decimal.precision).toBe(before.precision);
    expect(Decimal.rounding).toBe(before.rounding);
    expect(Decimal.toExpNeg).toBe(before.toExpNeg);
    expect(Decimal.toExpPos).toBe(before.toExpPos);
  });

  it('treats decimal-equivalent sizes, amounts and LIMIT prices as equal', () => {
    expect(
      orderIntentsEqual(sizeIntent({ size: '10' }), sizeIntent({ size: '10.00' })),
    ).toBe(true);
    expect(
      orderIntentsEqual(
        amountIntent({ amount: '100.1' }),
        amountIntent({ amount: '100.10' }),
      ),
    ).toBe(true);
    expect(
      orderIntentsEqual(
        sizeIntent({ limitPrice: '10.1' }),
        sizeIntent({ limitPrice: '10.10' }),
      ),
    ).toBe(true);
  });

  it('keeps size and amount as different intentions with the same value', () => {
    const size = sizeIntent({
      size: '10',
      type: 'MARKET',
      limitPrice: null,
    });
    const amount = amountIntent({
      amount: '10',
      type: 'MARKET',
      limitPrice: null,
    });

    expect(size.size).toBe('10');
    expect(amount.amount).toBe('10');
    expect(orderIntentsEqual(size, amount)).toBe(false);
  });

  it('detects differences in every semantic field', () => {
    const base = sizeIntent();

    expect(
      orderIntentsEqual(base, sizeIntent({ instrumentId: 48 })),
    ).toBe(false);
    expect(orderIntentsEqual(base, sizeIntent({ side: 'SELL' }))).toBe(false);
    expect(
      orderIntentsEqual(base, sizeIntent({ type: 'MARKET', limitPrice: null })),
    ).toBe(false);
    expect(orderIntentsEqual(base, amountIntent({ amount: '10' }))).toBe(false);
    expect(orderIntentsEqual(base, sizeIntent({ size: '11' }))).toBe(false);
    expect(
      orderIntentsEqual(base, sizeIntent({ limitPrice: '11' })),
    ).toBe(false);
  });

  it('keeps different amounts distinct even if a later conversion could produce the same quantity', () => {
    const first = amountIntent({ amount: '300', limitPrice: '300' });
    const second = amountIntent({ amount: '301', limitPrice: '300' });

    expect(first.amount).toBe('300');
    expect(second.amount).toBe('301');
    expect(orderIntentsEqual(first, second)).toBe(false);
  });

  it('accepts valid MARKET and LIMIT combinations', () => {
    expect(
      sizeIntent({ type: 'MARKET', limitPrice: null }),
    ).toMatchObject({
      type: 'MARKET',
      mode: 'size',
      size: '10',
      limitPrice: null,
    });
    expect(
      amountIntent({ type: 'MARKET', limitPrice: null }),
    ).toMatchObject({
      type: 'MARKET',
      mode: 'amount',
      amount: '100',
      limitPrice: null,
    });
    expect(sizeIntent({ type: 'LIMIT', limitPrice: '10.5' })).toMatchObject({
      type: 'LIMIT',
      limitPrice: '10.5',
    });
    expect(amountIntent({ type: 'LIMIT', limitPrice: '10.5' })).toMatchObject({
      type: 'LIMIT',
      amount: '100',
      limitPrice: '10.5',
    });
  });

  it('does not include execution close, derived quantity, status or availability', () => {
    expect(sizeIntent()).toEqual({
      instrumentId: 47,
      side: 'BUY',
      type: 'LIMIT',
      mode: 'size',
      size: '10',
      amount: null,
      limitPrice: '10',
    });
  });

  it('rejects both or neither size and amount', () => {
    expectIntentError(
      () =>
        createOrderIntent({
          instrumentId: 47,
          side: 'BUY',
          type: 'MARKET',
          size: '10',
          amount: '100',
        }),
      'invalid-mode',
    );
    expectIntentError(
      () =>
        createOrderIntent({
          instrumentId: 47,
          side: 'BUY',
          type: 'MARKET',
          size: null,
          amount: null,
        }),
      'invalid-mode',
    );
    expectIntentError(
      () =>
        createOrderIntent({
          instrumentId: 47,
          side: 'BUY',
          type: 'MARKET',
        }),
      'invalid-mode',
    );
  });

  it.each([
    ['zero', 0],
    ['negative', -1],
    ['fractional', 1.5],
    ['string', '47'],
    ['NaN', Number.NaN],
  ])('rejects an invalid instrument id: %s', (_label, instrumentId) => {
    expectIntentError(
      () =>
        createOrderIntent({
          instrumentId,
          side: 'BUY',
          type: 'MARKET',
          size: '1',
        }),
      'invalid-instrument',
    );
  });

  it.each([
    ['lowercase', 'buy'],
    ['unsupported', 'HOLD'],
    ['number', 1],
  ])('rejects an invalid side: %s', (_label, side) => {
    expectIntentError(
      () =>
        createOrderIntent({
          instrumentId: 47,
          side,
          type: 'MARKET',
          size: '1',
        }),
      'invalid-side',
    );
  });

  it.each([
    ['lowercase', 'market'],
    ['unsupported', 'STOP'],
    ['number', 1],
  ])('rejects an invalid type: %s', (_label, type) => {
    expectIntentError(
      () =>
        createOrderIntent({
          instrumentId: 47,
          side: 'BUY',
          type,
          size: '1',
        }),
      'invalid-type',
    );
  });

  it.each([
    ['zero', '0'],
    ['negative', '-1'],
    ['fractional', '1.5'],
    ['empty', ''],
    ['number', 3],
  ])('rejects an invalid size: %s', (_label, size) => {
    expectIntentError(() => sizeIntent({ size }), 'invalid-size');
  });

  it.each([
    ['zero', '0'],
    ['negative', '-1'],
    ['three decimals', '1.001'],
    ['empty', ''],
    ['number', 3],
  ])('rejects an invalid amount: %s', (_label, amount) => {
    expectIntentError(
      () => amountIntent({ amount }),
      'invalid-amount',
    );
  });

  it('rejects a price on MARKET intents', () => {
    expectIntentError(
      () => sizeIntent({ type: 'MARKET', limitPrice: '10' }),
      'invalid-limit-price',
    );
  });

  it('requires a price on LIMIT intents', () => {
    expectIntentError(
      () => sizeIntent({ type: 'LIMIT', limitPrice: null }),
      'invalid-limit-price',
    );
  });

  it.each([
    ['zero', '0'],
    ['negative', '-1'],
    ['three decimals', '1.001'],
    ['empty', ''],
    ['number', 3],
  ])('rejects an invalid LIMIT price: %s', (_label, limitPrice) => {
    expectIntentError(
      () => sizeIntent({ type: 'LIMIT', limitPrice }),
      'invalid-limit-price',
    );
  });
});
