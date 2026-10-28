import { describe, expect, it } from 'vitest';
import {
  createPreparedOrder,
  type PreparedOrderInput,
} from '../../src/orders/domain/prepared-order.js';
import { PreparedOrderError } from '../../src/orders/domain/prepared-order.error.js';
import {
  createOrderIntent,
  type OrderIntent,
  type OrderIntentInput,
} from '../../src/orders/domain/order-intent.js';
import { OrderIntentError } from '../../src/orders/domain/order-intent.error.js';

const KEY = '11111111-1111-4111-8111-111111111111';
const DATETIME = '2026-10-28T15:30:00.123456';

function marketIntent(
  overrides: Partial<OrderIntentInput> = {},
): OrderIntent {
  return createOrderIntent({
    instrumentId: 47,
    side: 'BUY',
    type: 'MARKET',
    size: '10',
    ...overrides,
  });
}

function limitIntent(
  overrides: Partial<OrderIntentInput> = {},
): OrderIntent {
  return createOrderIntent({
    instrumentId: 47,
    side: 'BUY',
    type: 'LIMIT',
    size: '10',
    limitPrice: '10.10',
    ...overrides,
  });
}

function amountIntent(
  overrides: Partial<OrderIntentInput> = {},
): OrderIntent {
  return createOrderIntent({
    instrumentId: 47,
    side: 'BUY',
    type: 'MARKET',
    amount: '1000',
    ...overrides,
  });
}

function preparedInput(
  overrides: Partial<PreparedOrderInput> = {},
): PreparedOrderInput {
  return {
    idempotencyKey: KEY,
    intent: marketIntent(),
    size: 10,
    price: '100',
    status: 'FILLED',
    datetime: DATETIME,
    ...overrides,
  };
}

function expectPreparedOrderError(
  action: () => unknown,
  code: string,
): void {
  let caught: unknown;

  try {
    action();
  } catch (error) {
    caught = error;
  }

  expect(caught).toBeInstanceOf(PreparedOrderError);
  expect(caught).toMatchObject({ code });
}

describe('createPreparedOrder', () => {
  it('returns the canonical prepared values for a MARKET FILLED order', () => {
    const order = createPreparedOrder(
      preparedInput({
        idempotencyKey: KEY.toUpperCase(),
        price: '100.00',
      }),
    );

    expect(order).toEqual({
      idempotencyKey: KEY,
      intent: marketIntent(),
      size: 10,
      price: '100',
      status: 'FILLED',
      datetime: DATETIME,
    });
  });

  it('accepts a LIMIT NEW order whose price matches the original limit', () => {
    const intent = limitIntent({ limitPrice: '10.10' });

    expect(
      createPreparedOrder(
        preparedInput({ intent, status: 'NEW', price: '10.1' }),
      ),
    ).toMatchObject({ status: 'NEW', price: '10.1' });
  });

  it.each(['MARKET', 'LIMIT'] as const)(
    'accepts a prepared REJECTED %s order',
    (type) => {
      const intent =
        type === 'MARKET' ? marketIntent() : limitIntent();
      const price = type === 'MARKET' ? '100' : '10.1';

      expect(
        createPreparedOrder(
          preparedInput({ intent, status: 'REJECTED', price }),
        ).status,
      ).toBe('REJECTED');
    },
  );

  it('keeps the final size independent from the original amount in amount mode', () => {
    const intent = amountIntent({ amount: '1000' });
    const order = createPreparedOrder(
      preparedInput({ intent, size: 3, price: '300' }),
    );

    expect(order.intent.amount).toBe('1000');
    expect(order.intent.mode).toBe('amount');
    expect(order.size).toBe(3);
  });

  it('accepts the largest size representable by the schema', () => {
    const order = createPreparedOrder(
      preparedInput({
        intent: marketIntent({ size: '2147483647' }),
        size: 2_147_483_647,
      }),
    );

    expect(order.size).toBe(2_147_483_647);
  });

  it('accepts the largest price representable by NUMERIC(10, 2)', () => {
    const order = createPreparedOrder(
      preparedInput({ price: '99999999.99' }),
    );

    expect(order.price).toBe('99999999.99');
  });

  it.each([
    '00000000-0000-0000-0000-000000000000',
    'ABCDEF01-2345-6789-abcd-ef0123456789',
  ])('accepts and lowercases the UUID %s', (key) => {
    expect(
      createPreparedOrder(preparedInput({ idempotencyKey: key }))
        .idempotencyKey,
    ).toBe(key.toLowerCase());
  });

  it.each([
    ['missing', undefined],
    ['empty', ''],
    ['without hyphens', KEY.replace(/-/g, '')],
    ['too short', '11111111-1111-4111-8111-11111111111'],
    ['non-hex', '11111111-1111-4111-8111-11111111111g'],
    ['numeric', 42],
  ])('rejects an %s idempotency key', (_label, key) => {
    expectPreparedOrderError(
      () =>
        createPreparedOrder(
          preparedInput({ idempotencyKey: key as string }),
        ),
      'invalid-idempotency-key',
    );
  });

  it.each([
    0,
    -1,
    1.5,
    Number.NaN,
    Number.POSITIVE_INFINITY,
    2_147_483_648,
    '10',
  ])('rejects the unrepresentable size %s', (size) => {
    expectPreparedOrderError(
      () =>
        createPreparedOrder(
          preparedInput({ size: size as number }),
        ),
      'invalid-size',
    );
  });

  it.each([
    ['zero', '0'],
    ['negative', '-1'],
    ['three decimals', '10.123'],
    ['exponent', '1e2'],
    ['integer overflow', '100000000'],
    ['not numeric', 'abc'],
    ['empty', ''],
    ['trailing separator', '10.'],
    ['leading separator', '.5'],
    ['explicit sign', '+10'],
    ['with spaces', ' 10 '],
  ])('rejects the price with %s', (_label, price) => {
    expectPreparedOrderError(
      () => createPreparedOrder(preparedInput({ price })),
      'invalid-price',
    );
  });

  it('canonicalizes valid price trailing zeros without rounding', () => {
    expect(
      createPreparedOrder(preparedInput({ price: '10.10' })).price,
    ).toBe('10.1');
    expect(
      createPreparedOrder(preparedInput({ price: '10.00' })).price,
    ).toBe('10');
    expect(
      createPreparedOrder(preparedInput({ price: '0.30' })).price,
    ).toBe('0.3');
  });

  it.each(['CANCELLED', 'PARTIAL', '', null, 1])(
    'rejects the status %s',
    (status) => {
      expectPreparedOrderError(
        () =>
          createPreparedOrder(
            preparedInput({ status: status as 'NEW' }),
          ),
        'invalid-status',
      );
    },
  );

  it('rejects a NEW MARKET order and a FILLED LIMIT order', () => {
    expectPreparedOrderError(
      () =>
        createPreparedOrder(
          preparedInput({ status: 'NEW', price: '100' }),
        ),
      'incompatible-status',
    );
    expectPreparedOrderError(
      () =>
        createPreparedOrder(
          preparedInput({
            intent: limitIntent(),
            status: 'FILLED',
            price: '10.1',
          }),
        ),
      'incompatible-status',
    );
  });

  it('rejects a final size that contradicts a size intent', () => {
    expectPreparedOrderError(
      () => createPreparedOrder(preparedInput({ size: 11 })),
      'size-intent-mismatch',
    );
  });

  it('rejects a LIMIT price that contradicts the original limit', () => {
    expectPreparedOrderError(
      () =>
        createPreparedOrder(
          preparedInput({
            intent: limitIntent({ limitPrice: '10.10' }),
            status: 'NEW',
            price: '10.11',
          }),
        ),
      'price-intent-mismatch',
    );
  });

  it.each([
    ['not a timestamp', '2026-10-28'],
    ['space separator', '2026-10-28 15:30:00'],
    ['timezone suffix', '2026-10-28T15:30:00Z'],
    ['offset suffix', '2026-10-28T15:30:00-03:00'],
    ['invalid month', '2026-13-01T00:00:00'],
    ['invalid day', '2026-04-31T00:00:00'],
    ['non-leap February 29', '2025-02-29T00:00:00'],
    ['invalid hour', '2026-10-28T24:00:00'],
    ['invalid minute', '2026-10-28T12:60:00'],
    ['invalid second', '2026-10-28T12:00:60'],
    ['seven fractional digits', '2026-10-28T12:00:00.1234567'],
    ['year zero', '0000-01-01T00:00:00'],
    ['numeric', 20261028],
  ])('rejects a datetime with %s', (_label, datetime) => {
    expectPreparedOrderError(
      () =>
        createPreparedOrder(
          preparedInput({ datetime: datetime as string }),
        ),
      'invalid-datetime',
    );
  });

  it('accepts leap-day and second-boundary datetimes without a timezone', () => {
    expect(
      createPreparedOrder(
        preparedInput({ datetime: '2024-02-29T23:59:59' }),
      ).datetime,
    ).toBe('2024-02-29T23:59:59');
    expect(
      createPreparedOrder(
        preparedInput({ datetime: '2026-12-31T00:00:00.1' }),
      ).datetime,
    ).toBe('2026-12-31T00:00:00.1');
  });

  it('rejects a missing intent and propagates invalid intent fields', () => {
    expectPreparedOrderError(
      () =>
        createPreparedOrder(
          preparedInput({ intent: null as unknown as OrderIntent }),
        ),
      'invalid-intent',
    );
    expect(() =>
      createPreparedOrder(
        preparedInput({
          intent: { ...marketIntent(), instrumentId: 0 },
        }),
      ),
    ).toThrow(OrderIntentError);
  });
});
