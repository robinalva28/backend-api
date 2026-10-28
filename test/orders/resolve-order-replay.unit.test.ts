import { describe, expect, it, vi } from 'vitest';
import { resolveOrderReplay } from '../../src/orders/application/resolve-order-replay.js';
import type { PersistedOrderRepository } from '../../src/orders/application/ports/out/persisted-order.repository.js';
import {
  buildOrderIntentMetadata,
} from '../../src/orders/domain/order-intent-metadata.js';
import {
  createOrderIntent,
  orderIntentsEqual,
  type OrderIntent,
  type OrderIntentInput,
} from '../../src/orders/domain/order-intent.js';
import { OrderIntentError } from '../../src/orders/domain/order-intent.error.js';
import type {
  PersistedOrder,
  PersistedOrderStatus,
} from '../../src/orders/domain/persisted-order.js';

const USER_ID = 4401;
const KEY = '11111111-1111-4111-8111-111111111111';

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

function amountIntent(
  overrides: Partial<OrderIntentInput> = {},
) {
  return createOrderIntent({
    instrumentId: 47,
    side: 'BUY',
    type: 'MARKET',
    size: null,
    amount: '100',
    limitPrice: null,
    ...overrides,
  });
}

function persistedOrder(
  intent: OrderIntent,
  status: PersistedOrderStatus = 'NEW',
  overrides: Partial<PersistedOrder> = {},
): PersistedOrder {
  return {
    id: 9,
    userId: USER_ID,
    idempotencyKey: KEY,
    status,
    intentMetadata: buildOrderIntentMetadata(intent),
    ...overrides,
  };
}

function createRepository(order: PersistedOrder | null) {
  const findByUserIdAndIdempotencyKey =
    vi.fn<PersistedOrderRepository['findByUserIdAndIdempotencyKey']>();
  findByUserIdAndIdempotencyKey.mockResolvedValue(order);
  const repository: PersistedOrderRepository = {
    findByUserIdAndIdempotencyKey,
  };

  return { repository, findByUserIdAndIdempotencyKey };
}

function expectOrderIntentError(
  action: () => Promise<unknown>,
  code: string,
): Promise<void> {
  return action().then(
    () => {
      throw new Error(`Expected OrderIntentError code ${code}.`);
    },
    (error: unknown) => {
      expect(error).toBeInstanceOf(OrderIntentError);
      expect(error).toMatchObject({ code });
    },
  );
}

describe('resolveOrderReplay', () => {
  it.each(['NEW', 'FILLED', 'REJECTED', 'CANCELLED'] as const)(
    'returns the persisted order in %s status for the same intent',
    async (status) => {
      const intent = sizeIntent();
      const order = persistedOrder(intent, status);
      const { repository, findByUserIdAndIdempotencyKey } =
        createRepository(order);

      await expect(
        resolveOrderReplay(repository, {
          userId: USER_ID,
          idempotencyKey: KEY,
          intent,
        }),
      ).resolves.toEqual({ outcome: 'match', order });
      expect(findByUserIdAndIdempotencyKey).toHaveBeenCalledTimes(1);
      expect(findByUserIdAndIdempotencyKey).toHaveBeenCalledWith(
        USER_ID,
        KEY,
      );
    },
  );

  it('returns absent without creating anything when the key is missing', async () => {
    const { repository, findByUserIdAndIdempotencyKey } =
      createRepository(null);

    await expect(
      resolveOrderReplay(repository, {
        userId: USER_ID,
        idempotencyKey: KEY,
        intent: sizeIntent(),
      }),
    ).resolves.toEqual({ outcome: 'absent' });
    expect(findByUserIdAndIdempotencyKey).toHaveBeenCalledTimes(1);
  });

  it('returns conflict for a different semantic intent without returning the order', async () => {
    const stored = amountIntent({ amount: '300' });
    const requested = amountIntent({ amount: '301' });
    const order = persistedOrder(stored);
    const { repository } = createRepository(order);

    await expect(
      resolveOrderReplay(repository, {
        userId: USER_ID,
        idempotencyKey: KEY,
        intent: requested,
      }),
    ).resolves.toEqual({ outcome: 'conflict' });
  });

  it('keeps size and amount as different intents even with the same value', async () => {
    const size = sizeIntent({ size: '10' });
    const amount = amountIntent({ amount: '10' });
    const { repository } = createRepository(persistedOrder(size));

    await expect(
      resolveOrderReplay(repository, {
        userId: USER_ID,
        idempotencyKey: KEY,
        intent: amount,
      }),
    ).resolves.toEqual({ outcome: 'conflict' });
  });

  it('is independent of JSON property order', async () => {
    const intent = sizeIntent({
      type: 'LIMIT',
      limitPrice: '10.10',
    });
    const metadata = buildOrderIntentMetadata(intent);
    const reordered = {
      parameters: {
        limitPrice: metadata.parameters.limitPrice,
        size: metadata.parameters.size,
        mode: metadata.parameters.mode,
        type: metadata.parameters.type,
        side: metadata.parameters.side,
        instrumentId: metadata.parameters.instrumentId,
      },
      version: metadata.version,
    };
    const order = persistedOrder(intent, 'FILLED', {
      intentMetadata: reordered,
    });
    const { repository } = createRepository(order);

    await expect(
      resolveOrderReplay(repository, {
        userId: USER_ID,
        idempotencyKey: KEY,
        intent,
      }),
    ).resolves.toEqual({ outcome: 'match', order });
  });

  it('propagates invalid metadata instead of returning a match or conflict', async () => {
    const order = persistedOrder(sizeIntent(), 'NEW', {
      intentMetadata: { version: 1, parameters: {} },
    });
    const { repository } = createRepository(order);

    await expectOrderIntentError(
      () =>
        resolveOrderReplay(repository, {
          userId: USER_ID,
          idempotencyKey: KEY,
          intent: sizeIntent(),
        }),
      'invalid-metadata',
    );
  });

  it('propagates an unknown metadata version as an internal error', async () => {
    const order = persistedOrder(sizeIntent(), 'CANCELLED', {
      intentMetadata: { version: 2, parameters: {} },
    });
    const { repository } = createRepository(order);

    await expectOrderIntentError(
      () =>
        resolveOrderReplay(repository, {
          userId: USER_ID,
          idempotencyKey: KEY,
          intent: sizeIntent(),
        }),
      'unsupported-metadata-version',
    );
  });

  it('propagates a repository failure instead of reporting absence', async () => {
    const failure = new Error('database unavailable');
    const findByUserIdAndIdempotencyKey =
      vi.fn<PersistedOrderRepository['findByUserIdAndIdempotencyKey']>();
    findByUserIdAndIdempotencyKey.mockRejectedValue(failure);
    const repository: PersistedOrderRepository = {
      findByUserIdAndIdempotencyKey,
    };

    await expect(
      resolveOrderReplay(repository, {
        userId: USER_ID,
        idempotencyKey: KEY,
        intent: sizeIntent(),
      }),
    ).rejects.toBe(failure);
    expect(findByUserIdAndIdempotencyKey).toHaveBeenCalledTimes(1);
  });

  it('only reads through the repository and does not expose a mutation path', async () => {
    const intent = sizeIntent();
    const order = persistedOrder(intent);
    const { repository, findByUserIdAndIdempotencyKey } =
      createRepository(order);

    const result = await resolveOrderReplay(repository, {
      userId: USER_ID,
      idempotencyKey: KEY,
      intent,
    });

    expect(result.outcome).toBe('match');
    expect(findByUserIdAndIdempotencyKey).toHaveBeenCalledTimes(1);
    expect(Object.keys(repository)).toEqual([
      'findByUserIdAndIdempotencyKey',
    ]);
  });

  it('preserves the canonical intent when comparing equivalent decimals', async () => {
    const stored = sizeIntent({ size: '10.00' });
    const requested = sizeIntent({ size: '10' });

    expect(orderIntentsEqual(stored, requested)).toBe(true);
    const { repository } = createRepository(persistedOrder(stored));

    await expect(
      resolveOrderReplay(repository, {
        userId: USER_ID,
        idempotencyKey: KEY,
        intent: requested,
      }),
    ).resolves.toMatchObject({ outcome: 'match' });
  });
});
