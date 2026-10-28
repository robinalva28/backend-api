import { describe, expect, it, vi } from 'vitest';
import { PreparedOrderPersistenceError } from '../../src/orders/application/errors/prepared-order-persistence.error.js';
import { buildOrderIntentMetadata } from '../../src/orders/domain/order-intent-metadata.js';
import {
  createOrderIntent,
  type OrderIntent,
  type OrderIntentInput,
} from '../../src/orders/domain/order-intent.js';
import {
  createPreparedOrder,
  type PreparedOrder,
  type PreparedOrderStatus,
} from '../../src/orders/domain/prepared-order.js';
import { PreparedOrderError } from '../../src/orders/domain/prepared-order.error.js';
import {
  PostgresPreparedOrderRepository,
  type PostgresQueryable,
} from '../../src/orders/infrastructure/persistence/postgres-prepared-order.repository.js';

interface QueryCall {
  readonly text: string;
  readonly values: unknown[];
}

interface InsertedRow {
  id: number | null;
}

const USER_ID = 4401;
const KEY = '11111111-1111-4111-8111-111111111111';
const DATETIME = '2026-10-28T15:30:00.123456';

function createQueryable(
  rows: InsertedRow[] = [{ id: 77 }],
): {
  queryable: PostgresQueryable;
  calls: QueryCall[];
} {
  const calls: QueryCall[] = [];
  const query = vi.fn(async (text: string, values: unknown[]) => {
    calls.push({ text, values });

    return {
      rows,
      command: 'INSERT',
      rowCount: rows.length,
      oid: 0,
      fields: [],
    };
  });

  return {
    queryable: { query } as PostgresQueryable,
    calls,
  };
}

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

function preparedOrder(
  overrides: Partial<Parameters<typeof createPreparedOrder>[0]> = {},
) {
  return createPreparedOrder({
    idempotencyKey: KEY,
    intent: marketIntent(),
    size: 10,
    price: '100',
    status: 'FILLED',
    datetime: DATETIME,
    ...overrides,
  });
}

function parseMetadata(value: unknown): unknown {
  expect(typeof value).toBe('string');

  return JSON.parse(value as string);
}

describe('PostgresPreparedOrderRepository', () => {
  it('inserts a parameterized prepared order without conflict handling or mutations', async () => {
    const { queryable, calls } = createQueryable();
    const repository = new PostgresPreparedOrderRepository(
      queryable,
      USER_ID,
    );

    await repository.insert(preparedOrder());

    expect(calls).toHaveLength(1);
    const text = calls[0]?.text ?? '';
    expect(text).toContain('INSERT INTO orders');
    expect(text).toContain('RETURNING id');
    expect(text).toContain('$1');
    expect(text).toContain('$10');
    expect(text).not.toMatch(/ON\s+CONFLICT/i);
    expect(text).not.toMatch(/\b(UPDATE|DELETE|BEGIN|COMMIT|ROLLBACK)\b/i);
    expect(text).not.toContain(KEY);
    expect(text).not.toContain(String(USER_ID));
  });

  it('binds the account, prepared values, key and versioned metadata', async () => {
    const { queryable, calls } = createQueryable();
    const repository = new PostgresPreparedOrderRepository(
      queryable,
      USER_ID,
    );
    const order = preparedOrder({
      intent: limitIntent({ side: 'SELL', size: '10' }),
      status: 'NEW',
      price: '10.1',
    });

    await repository.insert(order);

    expect(calls[0]?.values).toEqual([
      47,
      USER_ID,
      10,
      '10.1',
      'LIMIT',
      'SELL',
      'NEW',
      DATETIME,
      KEY,
      JSON.stringify(buildOrderIntentMetadata(order.intent)),
    ]);
    expect(parseMetadata(calls[0]?.values[9])).toEqual(
      buildOrderIntentMetadata(order.intent),
    );
  });

  it('preserves the original amount when the final size is derived', async () => {
    const { queryable, calls } = createQueryable();
    const repository = new PostgresPreparedOrderRepository(
      queryable,
      USER_ID,
    );
    const intent = marketIntent({ size: null, amount: '1000' });
    const order = preparedOrder({ intent, size: 3, price: '300' });

    await repository.insert(order);

    const metadata = parseMetadata(calls[0]?.values[9]) as {
      version: number;
      parameters: Record<string, unknown>;
    };
    expect(metadata.version).toBe(1);
    expect(metadata.parameters).toEqual({
      instrumentId: 47,
      side: 'BUY',
      type: 'MARKET',
      mode: 'amount',
      amount: '1000',
    });
    expect(calls[0]?.values[2]).toBe(3);
    expect(calls[0]?.values[3]).toBe('300');
  });

  it.each([
    ['FILLED', 'MARKET', '100'],
    ['REJECTED', 'MARKET', '100'],
    ['NEW', 'LIMIT', '10.1'],
    ['REJECTED', 'LIMIT', '10.1'],
  ] as const)(
    'binds the prepared %s status for a %s order',
    async (status: PreparedOrderStatus, type: 'MARKET' | 'LIMIT', price) => {
      const { queryable, calls } = createQueryable();
      const repository = new PostgresPreparedOrderRepository(
        queryable,
        USER_ID,
      );
      const intent = type === 'MARKET' ? marketIntent() : limitIntent();

      await repository.insert(preparedOrder({ intent, status, price }));

      expect(calls[0]?.values[4]).toBe(type);
      expect(calls[0]?.values[6]).toBe(status);
    },
  );

  it('returns the persisted order summary with the built metadata', async () => {
    const { queryable } = createQueryable([{ id: 91 }]);
    const repository = new PostgresPreparedOrderRepository(
      queryable,
      USER_ID,
    );
    const order = preparedOrder();

    await expect(repository.insert(order)).resolves.toEqual({
      id: 91,
      userId: USER_ID,
      idempotencyKey: KEY,
      status: 'FILLED',
      intentMetadata: buildOrderIntentMetadata(order.intent),
    });
  });

  it('binds each repository instance to its own account', async () => {
    const { queryable, calls } = createQueryable();
    const first = new PostgresPreparedOrderRepository(queryable, 4401);
    const second = new PostgresPreparedOrderRepository(queryable, 4402);

    await first.insert(preparedOrder());
    await second.insert(preparedOrder());

    expect(calls[0]?.values[1]).toBe(4401);
    expect(calls[1]?.values[1]).toBe(4402);
  });

  it('preserves the driver cause and constraint identification', async () => {
    const failure = Object.assign(new Error('duplicate key value'), {
      code: '23505',
      constraint: 'orders_user_idempotency_key_unique',
      detail: 'Key (userid, idempotency_key) already exists.',
    });
    const query = vi.fn().mockRejectedValueOnce(failure);
    const repository = new PostgresPreparedOrderRepository(
      { query } as unknown as PostgresQueryable,
      USER_ID,
    );

    let caught: unknown;

    try {
      await repository.insert(preparedOrder());
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(PreparedOrderPersistenceError);
    expect(caught).toMatchObject({
      code: '23505',
      constraint: 'orders_user_idempotency_key_unique',
      cause: failure,
    });
    expect(caught).not.toHaveProperty('detail');
  });

  it('does not invent technical fields for a non-driver failure', async () => {
    const query = vi.fn().mockRejectedValueOnce('unavailable');
    const repository = new PostgresPreparedOrderRepository(
      { query } as unknown as PostgresQueryable,
      USER_ID,
    );

    let caught: unknown;

    try {
      await repository.insert(preparedOrder());
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(PreparedOrderPersistenceError);
    expect(caught).toMatchObject({
      code: undefined,
      constraint: undefined,
      cause: 'unavailable',
    });
  });

  it.each([[[]], [[{ id: null }]], [[{ id: 0 }]], [[{ id: 1.5 }]]])(
    'rejects a missing or malformed RETURNING id',
    async (rows) => {
      const { queryable } = createQueryable(rows as InsertedRow[]);
      const repository = new PostgresPreparedOrderRepository(
        queryable,
        USER_ID,
      );

      let caught: unknown;

      try {
        await repository.insert(preparedOrder());
      } catch (error) {
        caught = error;
      }

      expect(caught).toBeInstanceOf(PreparedOrderPersistenceError);
      expect((caught as Error).cause).toBeInstanceOf(Error);
    },
  );

  it('rejects an unrepresentable prepared order before querying', async () => {
    const { queryable, calls } = createQueryable();
    const repository = new PostgresPreparedOrderRepository(
      queryable,
      USER_ID,
    );
    const invalid = {
      ...preparedOrder(),
      size: 2_147_483_648,
    } as PreparedOrder;

    await expect(repository.insert(invalid)).rejects.toBeInstanceOf(
      PreparedOrderError,
    );
    expect(calls).toHaveLength(0);
  });

  it('does not turn a duplicate into a recovery or a successful insert', async () => {
    const failure = Object.assign(new Error('duplicate key value'), {
      code: '23505',
      constraint: 'orders_user_idempotency_key_unique',
    });
    const query = vi.fn().mockRejectedValueOnce(failure);
    const repository = new PostgresPreparedOrderRepository(
      { query } as unknown as PostgresQueryable,
      USER_ID,
    );

    await expect(repository.insert(preparedOrder())).rejects.toBeInstanceOf(
      PreparedOrderPersistenceError,
    );
    expect(query).toHaveBeenCalledTimes(1);
  });
});
