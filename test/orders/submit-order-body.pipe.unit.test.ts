import { BadRequestException } from '@nestjs/common';
import { describe, expect, it } from 'vitest';
import type { OrderIntent } from '../../src/orders/domain/order-intent.js';
import { SubmitOrderBodyPipe } from '../../src/orders/infrastructure/http/submit-order-body.pipe.js';

const pipe = new SubmitOrderBodyPipe();

const VALID: Array<{
  readonly label: string;
  readonly body: Record<string, unknown>;
  readonly expected: OrderIntent;
}> = [
  {
    label: 'LIMIT size',
    body: {
      instrumentId: 47,
      side: 'BUY',
      type: 'LIMIT',
      size: 3,
      price: '10.00',
    },
    expected: {
      instrumentId: 47,
      side: 'BUY',
      type: 'LIMIT',
      mode: 'size',
      size: '3',
      amount: null,
      limitPrice: '10',
    },
  },
  {
    label: 'BUY MARKET size',
    body: {
      instrumentId: 47,
      side: 'BUY',
      type: 'MARKET',
      size: 2,
    },
    expected: {
      instrumentId: 47,
      side: 'BUY',
      type: 'MARKET',
      mode: 'size',
      size: '2',
      amount: null,
      limitPrice: null,
    },
  },
  {
    label: 'SELL MARKET amount with leading zeroes',
    body: {
      instrumentId: 47,
      side: 'SELL',
      type: 'MARKET',
      amount: '0001.00',
    },
    expected: {
      instrumentId: 47,
      side: 'SELL',
      type: 'MARKET',
      mode: 'amount',
      size: null,
      amount: '1',
      limitPrice: null,
    },
  },
  {
    label: 'SELL LIMIT amount with leading-zero price',
    body: {
      instrumentId: 47,
      side: 'SELL',
      type: 'LIMIT',
      amount: '10.00',
      price: '000000001.00',
    },
    expected: {
      instrumentId: 47,
      side: 'SELL',
      type: 'LIMIT',
      mode: 'amount',
      size: null,
      amount: '10',
      limitPrice: '1',
    },
  },
  {
    label: 'size 3.0 parsed as 3',
    body: {
      instrumentId: 2147483647,
      side: 'BUY',
      type: 'MARKET',
      size: 3.0,
    },
    expected: {
      instrumentId: 2147483647,
      side: 'BUY',
      type: 'MARKET',
      mode: 'size',
      size: '3',
      amount: null,
      limitPrice: null,
    },
  },
  {
    label: 'size 1e3 parsed as 1000',
    body: {
      instrumentId: 1,
      side: 'BUY',
      type: 'MARKET',
      size: 1e3,
    },
    expected: {
      instrumentId: 1,
      side: 'BUY',
      type: 'MARKET',
      mode: 'size',
      size: '1000',
      amount: null,
      limitPrice: null,
    },
  },
  {
    label: 'price with eight integer digits',
    body: {
      instrumentId: 47,
      side: 'BUY',
      type: 'LIMIT',
      size: 1,
      price: '12345678.90',
    },
    expected: {
      instrumentId: 47,
      side: 'BUY',
      type: 'LIMIT',
      mode: 'size',
      size: '1',
      amount: null,
      limitPrice: '12345678.9',
    },
  },
  {
    label: 'amount without the price integer-digit limit',
    body: {
      instrumentId: 47,
      side: 'BUY',
      type: 'MARKET',
      amount: '123456789.00',
    },
    expected: {
      instrumentId: 47,
      side: 'BUY',
      type: 'MARKET',
      mode: 'amount',
      size: null,
      amount: '123456789',
      limitPrice: null,
    },
  },
  {
    label: 'very large amount is lexically accepted',
    body: {
      instrumentId: 47,
      side: 'BUY',
      type: 'MARKET',
      amount: '999999999999999999999999999999',
    },
    expected: {
      instrumentId: 47,
      side: 'BUY',
      type: 'MARKET',
      mode: 'amount',
      size: null,
      amount: '999999999999999999999999999999',
      limitPrice: null,
    },
  },
  {
    label: 'size INT boundary',
    body: {
      instrumentId: 47,
      side: 'BUY',
      type: 'MARKET',
      size: 2147483647,
    },
    expected: {
      instrumentId: 47,
      side: 'BUY',
      type: 'MARKET',
      mode: 'size',
      size: '2147483647',
      amount: null,
      limitPrice: null,
    },
  },
];

describe('SubmitOrderBodyPipe — valid input', () => {
  it.each(VALID)('accepts $label and returns the canonical intent', async ({
    body,
    expected,
  }) => {
    await expect(pipe.transform(body)).resolves.toEqual(expected);
  });
});

describe('SubmitOrderBodyPipe — unknown fields in the original JSON', () => {
  const validJson =
    '{"instrumentId":47,"side":"BUY","type":"LIMIT","size":3,"price":"10.00"}';

  it('accepts a JSON object that only contains allowed fields', async () => {
    const body = JSON.parse(validJson) as Record<string, unknown>;

    await expect(pipe.transform(body)).resolves.toEqual({
      instrumentId: 47,
      side: 'BUY',
      type: 'LIMIT',
      mode: 'size',
      size: '3',
      amount: null,
      limitPrice: '10',
    });
  });

  it.each([
    [
      'currency',
      '{"instrumentId":47,"side":"BUY","type":"LIMIT","size":3,"price":"10.00","currency":"ARS"}',
    ],
    [
      '__proto__',
      '{"instrumentId":47,"side":"BUY","type":"LIMIT","size":3,"price":"10.00","__proto__":{"polluted":true}}',
    ],
    [
      'constructor',
      '{"instrumentId":47,"side":"BUY","type":"LIMIT","size":3,"price":"10.00","constructor":{"polluted":true}}',
    ],
  ])(
    'rejects the own %s unknown field parsed from JSON',
    async (field, rawJson) => {
      const body = JSON.parse(rawJson) as Record<string, unknown>;

      expect(Object.hasOwn(body, field)).toBe(true);
      await expectInvalid(body);
    },
  );
});

describe('SubmitOrderBodyPipe — invalid roots and shape', () => {
  it.each([
    ['null', null],
    ['array', []],
    ['string', 'not an object'],
    ['number', 42],
    ['boolean', true],
  ])('rejects a %s root', async (_label, value) => {
    await expectInvalid(value);
  });

  it.each([
    ['unknown currency', { currency: 'ARS' }],
    ['unknown ticker', { ticker: 'PAMP' }],
    ['unknown userId', { userId: 1 }],
  ])('rejects the %s property', async (_label, extra) => {
    await expectInvalid({
      instrumentId: 47,
      side: 'BUY',
      type: 'LIMIT',
      size: 1,
      price: '10.00',
      ...extra,
    });
  });

  it.each([
    ['missing instrumentId', { side: 'BUY', type: 'MARKET', size: 1 }],
    ['missing side', { instrumentId: 47, type: 'MARKET', size: 1 }],
    ['missing type', { instrumentId: 47, side: 'BUY', size: 1 }],
    [
      'both size and amount',
      {
        instrumentId: 47,
        side: 'BUY',
        type: 'MARKET',
        size: 1,
        amount: '10.00',
      },
    ],
    [
      'neither size nor amount',
      { instrumentId: 47, side: 'BUY', type: 'MARKET' },
    ],
    [
      'MARKET with a price',
      {
        instrumentId: 47,
        side: 'BUY',
        type: 'MARKET',
        size: 1,
        price: '10.00',
      },
    ],
    [
      'MARKET with a null price',
      {
        instrumentId: 47,
        side: 'BUY',
        type: 'MARKET',
        size: 1,
        price: null,
      },
    ],
    [
      'LIMIT without a price',
      { instrumentId: 47, side: 'BUY', type: 'LIMIT', size: 1 },
    ],
  ])('rejects %s', async (_label, body) => {
    await expectInvalid(body);
  });
});

describe('SubmitOrderBodyPipe — invalid field values', () => {
  const invalidFields: Array<readonly [string, Record<string, unknown>]> = [
    ['null instrumentId', { instrumentId: null }],
    ['string instrumentId', { instrumentId: '47' }],
    ['zero instrumentId', { instrumentId: 0 }],
    ['fractional instrumentId', { instrumentId: 1.5 }],
    ['instrumentId above INT', { instrumentId: 2147483648 }],
    ['lowercase side', { side: 'buy' }],
    ['side with trailing space', { side: 'BUY ' }],
    ['unknown side', { side: 'HOLD' }],
    ['null side', { side: null }],
    ['lowercase type', { type: 'market' }],
    ['type with trailing space', { type: 'MARKET ' }],
    ['unknown type', { type: 'STOP' }],
    ['null type', { type: null }],
    ['string size', { size: '3' }],
    ['zero size', { size: 0 }],
    ['negative size', { size: -1 }],
    ['fractional size', { size: 1.5 }],
    ['null size', { size: null }],
    ['size above INT', { size: 2147483648 }],
    ['numeric amount', { amount: 10 }],
    ['null amount', { amount: null }],
    ['empty amount', { amount: '' }],
    ['zero amount', { amount: '0' }],
    ['zero decimal amount', { amount: '0.00' }],
    ['negative amount', { amount: '-1' }],
    ['signed amount', { amount: '+1' }],
    ['leading-space amount', { amount: ' 1' }],
    ['trailing-space amount', { amount: '1 ' }],
    ['trailing-newline amount', { amount: '1\n' }],
    ['comma amount', { amount: '1,0' }],
    ['exponent amount', { amount: '1e3' }],
    ['hex amount', { amount: '0x10' }],
    ['underscore amount', { amount: '1_000' }],
    ['three written decimals', { amount: '10.000' }],
    ['three non-zero decimals', { amount: '10.001' }],
    ['trailing-dot amount', { amount: '10.' }],
    ['leading-dot amount', { amount: '.5' }],
    ['two dots amount', { amount: '1.2.3' }],
    ['numeric price', { price: 10, type: 'LIMIT' }],
    ['null price in LIMIT', { price: null, type: 'LIMIT' }],
    ['empty price', { price: '', type: 'LIMIT' }],
    ['zero price', { price: '0', type: 'LIMIT' }],
    ['zero decimal price', { price: '0.00', type: 'LIMIT' }],
    ['negative price', { price: '-1', type: 'LIMIT' }],
    ['signed price', { price: '+1', type: 'LIMIT' }],
    ['leading-space price', { price: ' 1', type: 'LIMIT' }],
    ['trailing-space price', { price: '1 ', type: 'LIMIT' }],
    ['comma price', { price: '1,0', type: 'LIMIT' }],
    ['exponent price', { price: '1e3', type: 'LIMIT' }],
    ['hex price', { price: '0x10', type: 'LIMIT' }],
    ['underscore price', { price: '1_000', type: 'LIMIT' }],
    ['three written price decimals', { price: '10.000', type: 'LIMIT' }],
    ['three non-zero price decimals', { price: '10.001', type: 'LIMIT' }],
    ['nine price integer digits', { price: '123456789.00', type: 'LIMIT' }],
    [
      'nine normalized price integer digits',
      { price: '000000000100000000.00', type: 'LIMIT' },
    ],
  ];

  it.each(invalidFields)('rejects %s', async (_label, override) => {
    const body: Record<string, unknown> = {
      instrumentId: 47,
      side: 'BUY',
      type: 'MARKET',
      size: 1,
      ...override,
    };

    if (override['type'] !== 'LIMIT' && !('amount' in override)) {
      delete body['amount'];
    }

    if (override['type'] === 'LIMIT' && !('price' in override)) {
      body['price'] = '10.00';
    }

    if ('amount' in override && !('size' in override)) {
      delete body['size'];
    }

    await expectInvalid(body);
  });
});

async function expectInvalid(value: unknown): Promise<void> {
  try {
    await pipe.transform(value);
  } catch (error) {
    expect(error).toBeInstanceOf(BadRequestException);
    const exception = error as BadRequestException;
    expect(exception.getStatus()).toBe(400);
    expect(exception.getResponse()).toMatchObject({
      message: 'Invalid request.',
    });
    return;
  }

  throw new Error('Expected the pipe to reject the value.');
}
