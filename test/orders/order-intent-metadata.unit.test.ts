import { describe, expect, it } from 'vitest';
import {
  buildOrderIntentMetadata,
  readOrderIntentMetadata,
} from '../../src/orders/domain/order-intent-metadata.js';
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
    type: 'MARKET',
    size: '10',
    amount: null,
    limitPrice: null,
    ...overrides,
  });
}

function amountIntent(overrides: Partial<OrderIntentInput> = {}) {
  return createOrderIntent({
    instrumentId: 47,
    side: 'SELL',
    type: 'MARKET',
    size: null,
    amount: '100',
    limitPrice: null,
    ...overrides,
  });
}

function validParameters(
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    instrumentId: 47,
    side: 'BUY',
    type: 'MARKET',
    mode: 'size',
    size: '10',
    ...overrides,
  };
}

function metadata(
  parameters: Record<string, unknown> = validParameters(),
  version: unknown = 1,
): unknown {
  return { version, parameters };
}

function expectMetadataError(value: unknown, expectedCode: string): void {
  try {
    readOrderIntentMetadata(value);
  } catch (error) {
    expect(error).toBeInstanceOf(OrderIntentError);
    expect(error).toMatchObject({ code: expectedCode });
    return;
  }

  throw new Error(`Expected OrderIntentError code ${expectedCode}.`);
}

describe('order intent metadata', () => {
  it('builds version 1 metadata for a size LIMIT intent', () => {
    const intent = sizeIntent({
      type: 'LIMIT',
      size: '10.00',
      limitPrice: '10.10',
    });

    const result = buildOrderIntentMetadata(intent);

    expect(result).toEqual({
      version: 1,
      parameters: {
        instrumentId: 47,
        side: 'BUY',
        type: 'LIMIT',
        mode: 'size',
        size: '10',
        limitPrice: '10.1',
      },
    });
    expect(Object.hasOwn(result.parameters, 'amount')).toBe(false);
  });

  it('builds version 1 metadata for an amount MARKET intent', () => {
    const intent = amountIntent({
      type: 'MARKET',
      amount: '100.00',
      limitPrice: null,
    });

    const result = buildOrderIntentMetadata(intent);

    expect(result).toEqual({
      version: 1,
      parameters: {
        instrumentId: 47,
        side: 'SELL',
        type: 'MARKET',
        mode: 'amount',
        amount: '100',
      },
    });
    expect(Object.hasOwn(result.parameters, 'size')).toBe(false);
    expect(Object.hasOwn(result.parameters, 'limitPrice')).toBe(false);
  });

  it('round-trips version 1 metadata through JSON and preserves the intent', () => {
    const intents = [
      sizeIntent({ type: 'LIMIT', size: '10.00', limitPrice: '10.10' }),
      sizeIntent({ type: 'MARKET', limitPrice: null }),
      amountIntent({ type: 'LIMIT', amount: '100.10', limitPrice: '10.10' }),
      amountIntent({ type: 'MARKET', limitPrice: null }),
    ];

    for (const intent of intents) {
      const persisted: unknown = JSON.parse(
        JSON.stringify(buildOrderIntentMetadata(intent)),
      );
      const read = readOrderIntentMetadata(persisted);

      expect(orderIntentsEqual(read, intent)).toBe(true);
    }
  });

  it('does not depend on JSON property order', () => {
    const intent = sizeIntent({
      type: 'LIMIT',
      size: '10',
      limitPrice: '10.1',
    });
    const reordered = {
      parameters: {
        limitPrice: '10.1',
        size: '10',
        mode: 'size',
        type: 'LIMIT',
        side: 'BUY',
        instrumentId: 47,
      },
      version: 1,
    };

    expect(orderIntentsEqual(readOrderIntentMetadata(reordered), intent)).toBe(
      true,
    );
  });

  it('normalizes valid decimal strings when reading persisted metadata', () => {
    const canonical = sizeIntent({
      type: 'LIMIT',
      size: '10',
      limitPrice: '10.1',
    });
    const persisted = metadata(
      validParameters({
        type: 'LIMIT',
        size: '10.00',
        limitPrice: '10.10',
      }),
    );

    const read = readOrderIntentMetadata(persisted);

    expect(read.size).toBe('10');
    expect(read.limitPrice).toBe('10.1');
    expect(orderIntentsEqual(read, canonical)).toBe(true);
  });

  it('accepts explicit null for the unused mode and MARKET price fields', () => {
    const read = readOrderIntentMetadata(
      metadata(
        validParameters({
          amount: null,
          limitPrice: null,
        }),
      ),
    );

    expect(read).toEqual(sizeIntent({ type: 'MARKET', limitPrice: null }));
  });

  it('rejects metadata that is not a versioned object', () => {
    expectMetadataError(undefined, 'invalid-metadata');
    expectMetadataError(null, 'invalid-metadata');
    expectMetadataError('metadata', 'invalid-metadata');
    expectMetadataError(1, 'invalid-metadata');
    expectMetadataError([], 'invalid-metadata');
    expectMetadataError({}, 'invalid-metadata');
  });

  it('rejects an unknown metadata version without treating it as a match', () => {
    expectMetadataError(
      metadata(validParameters(), 2),
      'unsupported-metadata-version',
    );
  });

  it.each([
    ['missing version', { parameters: validParameters() }, 'invalid-metadata'],
    ['string version', metadata(validParameters(), '1'), 'invalid-metadata'],
    ['zero version', metadata(validParameters(), 0), 'invalid-metadata'],
    ['negative version', metadata(validParameters(), -1), 'invalid-metadata'],
    ['fractional version', metadata(validParameters(), 1.5), 'invalid-metadata'],
    ['missing parameters', { version: 1 }, 'invalid-metadata'],
    ['null parameters', { version: 1, parameters: null }, 'invalid-metadata'],
    ['array parameters', { version: 1, parameters: [] }, 'invalid-metadata'],
    ['missing instrument', metadata(validParameters({ instrumentId: undefined })), 'invalid-metadata'],
    ['zero instrument', metadata(validParameters({ instrumentId: 0 })), 'invalid-metadata'],
    ['string instrument', metadata(validParameters({ instrumentId: '47' })), 'invalid-metadata'],
    ['invalid side', metadata(validParameters({ side: 'buy' })), 'invalid-metadata'],
    ['invalid type', metadata(validParameters({ type: 'market' })), 'invalid-metadata'],
    ['invalid mode', metadata(validParameters({ mode: 'value' })), 'invalid-metadata'],
    ['missing size', metadata(validParameters({ size: undefined })), 'invalid-metadata'],
    ['non-string size', metadata(validParameters({ size: 10 })), 'invalid-metadata'],
    ['fractional size', metadata(validParameters({ size: '1.5' })), 'invalid-metadata'],
    ['zero size', metadata(validParameters({ size: '0' })), 'invalid-metadata'],
    ['size and amount', metadata(validParameters({ amount: '20' })), 'invalid-metadata'],
    ['size in amount mode', metadata(validParameters({ mode: 'amount', size: '10', amount: '100' })), 'invalid-metadata'],
    ['missing amount', metadata(validParameters({ mode: 'amount', size: undefined })), 'invalid-metadata'],
    ['non-string amount', metadata(validParameters({ mode: 'amount', size: undefined, amount: 100 })), 'invalid-metadata'],
    ['excess amount scale', metadata(validParameters({ mode: 'amount', size: undefined, amount: '1.001' })), 'invalid-metadata'],
    ['LIMIT without price', metadata(validParameters({ type: 'LIMIT' })), 'invalid-metadata'],
    ['LIMIT with null price', metadata(validParameters({ type: 'LIMIT', limitPrice: null })), 'invalid-metadata'],
    ['MARKET with price', metadata(validParameters({ limitPrice: '10' })), 'invalid-metadata'],
    ['zero price', metadata(validParameters({ type: 'LIMIT', limitPrice: '0' })), 'invalid-metadata'],
    ['excess price scale', metadata(validParameters({ type: 'LIMIT', limitPrice: '1.001' })), 'invalid-metadata'],
    ['numeric price', metadata(validParameters({ type: 'LIMIT', limitPrice: 10 })), 'invalid-metadata'],
  ])('rejects invalid metadata: %s', (_label, value, code) => {
    expectMetadataError(value, code);
  });
});
