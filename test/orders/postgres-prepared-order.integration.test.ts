import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PreparedOrderPersistenceError } from '../../src/orders/application/errors/prepared-order-persistence.error.js';
import { resolveOrderReplay } from '../../src/orders/application/resolve-order-replay.js';
import type {
  AccountTransactionResult,
  AccountTransactionRunner,
} from '../../src/transactions/application/ports/out/account-transaction.port.js';
import { buildOrderIntentMetadata } from '../../src/orders/domain/order-intent-metadata.js';
import {
  createOrderIntent,
  type OrderIntent,
  type OrderIntentInput,
} from '../../src/orders/domain/order-intent.js';
import type { PersistedOrder } from '../../src/orders/domain/persisted-order.js';
import {
  createPreparedOrder,
  type PreparedOrder,
  type PreparedOrderInput,
} from '../../src/orders/domain/prepared-order.js';
import { PostgresPreparedOrderRepository } from '../../src/orders/infrastructure/persistence/postgres-prepared-order.repository.js';
import type { AccountResources } from '../../src/resources/domain/account-resources.js';
import { calculateAccountResources } from '../../src/resources/domain/calculate-account-resources.js';
import { PostgresAccountMovementRepository } from '../../src/resources/infrastructure/persistence/postgres-account-movement.repository.js';
import { AccountTransactionError } from '../../src/transactions/application/errors/account-transaction.error.js';
import { PostgresAccountTransactionRunner } from '../../src/transactions/infrastructure/persistence/postgres-account-transaction.runner.js';
import { testDatabaseConfig } from '../support/test-database.js';

const SCHEMA = 'b04e_test';
const INSTRUMENT_ID = 9001;
const CASH_INSTRUMENT_ID = 9002;
const DATETIME = '2026-10-28T15:30:00.123456';
const UNIQUE_CONSTRAINT = 'orders_user_idempotency_key_unique';

interface OrderRow {
  id: number;
  instrumentid: number;
  userid: number;
  size: number;
  price: string | null;
  type: string | null;
  side: string | null;
  status: string | null;
  datetime: string;
  idempotency_key: string;
  idempotency_metadata: unknown;
}

interface ReplayOrInsertValue {
  readonly outcome: 'created' | 'match' | 'conflict';
  readonly order: PersistedOrder | null;
}

let adminPool: Pool | undefined;
let pool: Pool | undefined;
let nextUserId = 9001;
let movements: PostgresAccountMovementRepository;

beforeAll(async () => {
  const [databaseSql, migrationSql] = await Promise.all([
    readFile(resolve(process.cwd(), 'database.sql'), 'utf8'),
    readFile(
      resolve(
        process.cwd(),
        'db/migrations/20261028-b04b-order-idempotency.sql',
      ),
      'utf8',
    ),
  ]);
  const config = testDatabaseConfig();
  adminPool = new Pool({ ...config, max: 1 });
  const client = await adminPool.connect();

  try {
    await client.query(`DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE`);
    await client.query(`CREATE SCHEMA ${SCHEMA}`);
    await client.query('BEGIN');

    try {
      await client.query(`SET LOCAL search_path TO ${SCHEMA}`);
      await client.query(databaseSql);
      await client.query(migrationSql);
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    }
  } finally {
    client.release();
  }

  pool = new Pool({
    ...config,
    max: 8,
    options: `-c search_path=${SCHEMA}`,
  });
  await pool.query(
    `INSERT INTO instruments (id, ticker, name, type)
     VALUES ($1, 'B04E', 'B04E fixture', 'ACCIONES'),
            ($2, 'B04ECASH', 'B04E cash fixture', 'MONEDA')`,
    [INSTRUMENT_ID, CASH_INSTRUMENT_ID],
  );
  movements = new PostgresAccountMovementRepository(pool);
});

afterAll(async () => {
  await pool?.end();
  await adminPool?.query(`DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE`);
  await adminPool?.end();
});

describe('prepared order persistence against PostgreSQL', () => {
  it('persists the row, key and versioned metadata together', async () => {
    const userId = await createAccount();
    const key = randomUUID();
    const intent = marketIntent({ size: null, amount: '1000' });
    const prepared = preparedOrder({
      idempotencyKey: key,
      intent,
      size: 3,
      price: '300',
      status: 'FILLED',
    });
    const repository = new PostgresPreparedOrderRepository(pool!, userId);

    const inserted = await repository.insert(prepared);
    const row = await readOrder(inserted.id);

    expect(row).toEqual({
      id: inserted.id,
      instrumentid: INSTRUMENT_ID,
      userid: userId,
      size: 3,
      price: '300.00',
      type: 'MARKET',
      side: 'BUY',
      status: 'FILLED',
      datetime: '2026-10-28 15:30:00.123456',
      idempotency_key: key,
      idempotency_metadata: {
        version: 1,
        parameters: {
          instrumentId: INSTRUMENT_ID,
          side: 'BUY',
          type: 'MARKET',
          mode: 'amount',
          amount: '1000',
        },
      },
    });
    expect(inserted).toEqual({
      id: inserted.id,
      userId,
      idempotencyKey: key,
      status: 'FILLED',
      intentMetadata: buildOrderIntentMetadata(intent),
    });
  });

  it('rolls back the order and key with the transaction, then allows a retry', async () => {
    const userId = await createAccount();
    const key = randomUUID();
    const prepared = preparedOrder({ idempotencyKey: key });
    const runner = new PostgresAccountTransactionRunner(pool!);

    let caught: unknown;

    try {
      await runner.run(userId, async (context) => {
        await context.preparedOrders.insert(prepared);
        throw new Error('force rollback');
      });
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(AccountTransactionError);
    expect(caught).toMatchObject({ stage: 'work' });
    expect(await countByKey(userId, key)).toBe(0);

    const retry = await runner.run(userId, async (context) => {
      return context.preparedOrders.insert(prepared);
    });

    expect(retry.status).toBe('committed');

    if (retry.status !== 'committed') {
      throw new Error('Expected a committed retry.');
    }

    expect(await countByKey(userId, key)).toBe(1);
    expect(await readOrder(retry.value.id)).toMatchObject({
      idempotency_key: key,
      status: 'FILLED',
    });
  });

  it('rejects a duplicate user/key without overwriting and identifies the constraint', async () => {
    const userId = await createAccount();
    const key = randomUUID();
    const repository = new PostgresPreparedOrderRepository(pool!, userId);
    const first = await repository.insert(
      preparedOrder({ idempotencyKey: key, size: 10, price: '100' }),
    );
    const before = await readOrder(first.id);
    const second = preparedOrder({
      idempotencyKey: key,
      intent: limitIntent({ size: '2', limitPrice: '50' }),
      size: 2,
      price: '50',
      status: 'NEW',
    });

    let caught: unknown;

    try {
      await repository.insert(second);
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(PreparedOrderPersistenceError);
    expect(caught).toMatchObject({
      code: '23505',
      constraint: UNIQUE_CONSTRAINT,
    });
    expect(await readOrder(first.id)).toEqual(before);
    expect(await countByKey(userId, key)).toBe(1);
  });

  it('accepts the same UUID for different accounts', async () => {
    const firstUser = await createAccount();
    const secondUser = await createAccount();
    const key = randomUUID();
    const first = await new PostgresPreparedOrderRepository(
      pool!,
      firstUser,
    ).insert(preparedOrder({ idempotencyKey: key }));
    const second = await new PostgresPreparedOrderRepository(
      pool!,
      secondUser,
    ).insert(
      preparedOrder({
        idempotencyKey: key,
        intent: limitIntent({ side: 'SELL', size: '4', limitPrice: '70' }),
        size: 4,
        price: '70',
        status: 'NEW',
      }),
    );

    expect(first.id).not.toBe(second.id);
    expect(await countByKey(firstUser, key)).toBe(1);
    expect(await countByKey(secondUser, key)).toBe(1);
    expect(await readOrder(first.id)).toMatchObject({
      userid: firstUser,
      size: 10,
      status: 'FILLED',
    });
    expect(await readOrder(second.id)).toMatchObject({
      userid: secondUser,
      size: 4,
      status: 'NEW',
    });
  });

  it('writes and reads the same order through one transaction context', async () => {
    const userId = await createAccount();
    const key = randomUUID();
    const prepared = preparedOrder({ idempotencyKey: key });
    const runner = new PostgresAccountTransactionRunner(pool!);

    const result = await runner.run(userId, async (context) => {
      const inserted = await context.preparedOrders.insert(prepared);
      const found =
        await context.persistedOrders.findByUserIdAndIdempotencyKey(
          userId,
          key,
        );

      return { inserted, found };
    });

    expect(result.status).toBe('committed');

    if (result.status !== 'committed') {
      throw new Error('Expected a committed transaction.');
    }

    expect(result.value.found).toMatchObject({
      id: result.value.inserted.id,
      userId,
      idempotencyKey: key,
      status: 'FILLED',
    });
    expect(await countByKey(userId, key)).toBe(1);
  });

  it('does not duplicate an order when concurrent replays resolve and write', async () => {
    const userId = await createAccount();
    const key = randomUUID();
    const intent = marketIntent({ size: '10' });
    const prepared = preparedOrder({ idempotencyKey: key, intent });
    const runnerA = new PostgresAccountTransactionRunner(pool!);
    const runnerB = new PostgresAccountTransactionRunner(pool!);

    const [first, second] = await Promise.all([
      replayOrInsert(runnerA, userId, key, intent, prepared),
      replayOrInsert(runnerB, userId, key, intent, prepared),
    ]);

    expect(first.status).toBe('committed');
    expect(second.status).toBe('committed');

    if (first.status !== 'committed' || second.status !== 'committed') {
      throw new Error('Both concurrent replays must commit.');
    }

    const values = [first.value, second.value];
    expect(values.filter(({ outcome }) => outcome === 'created')).toHaveLength(
      1,
    );
    expect(values.filter(({ outcome }) => outcome === 'match')).toHaveLength(
      1,
    );
    expect(values.filter(({ outcome }) => outcome === 'conflict')).toHaveLength(
      0,
    );
    expect(await countByKey(userId, key)).toBe(1);

    const created = values.find(({ outcome }) => outcome === 'created');
    const matched = values.find(({ outcome }) => outcome === 'match');
    expect(created?.order).not.toBeNull();
    expect(matched?.order?.id).toBe(created?.order?.id);
  });

  it('reflects BUY and SELL FILLED effects through B02', async () => {
    const userId = await createAccount();
    await insertCashIn(userId, 10_000);
    const repository = new PostgresPreparedOrderRepository(pool!, userId);

    await repository.insert(
      preparedOrder({
        idempotencyKey: randomUUID(),
        intent: marketIntent({ side: 'BUY', size: '5' }),
        size: 5,
        price: '100',
        status: 'FILLED',
      }),
    );
    await repository.insert(
      preparedOrder({
        idempotencyKey: randomUUID(),
        intent: marketIntent({ side: 'SELL', size: '2' }),
        size: 2,
        price: '120',
        status: 'FILLED',
      }),
    );

    const resources = await readResources(userId);

    expect(resources.accountingCash.toString()).toBe('9740');
    expect(resources.reservedBuyCash.toString()).toBe('0');
    expect(resources.availableCash.toString()).toBe('9740');
    expect(instrumentResources(resources)).toEqual({
      instrumentId: INSTRUMENT_ID,
      executedQuantity: 3,
      sellReservedQuantity: 0,
      availableQuantity: 3,
    });
  });

  it('reflects BUY and SELL NEW reserves through B02', async () => {
    const userId = await createAccount();
    await insertCashIn(userId, 10_000);
    const repository = new PostgresPreparedOrderRepository(pool!, userId);

    await repository.insert(
      preparedOrder({
        idempotencyKey: randomUUID(),
        intent: marketIntent({ side: 'BUY', size: '5' }),
        size: 5,
        price: '100',
        status: 'FILLED',
      }),
    );
    await repository.insert(
      preparedOrder({
        idempotencyKey: randomUUID(),
        intent: limitIntent({ side: 'BUY', size: '2', limitPrice: '50' }),
        size: 2,
        price: '50',
        status: 'NEW',
      }),
    );
    await repository.insert(
      preparedOrder({
        idempotencyKey: randomUUID(),
        intent: limitIntent({ side: 'SELL', size: '3', limitPrice: '70' }),
        size: 3,
        price: '70',
        status: 'NEW',
      }),
    );

    const resources = await readResources(userId);

    expect(resources.accountingCash.toString()).toBe('9500');
    expect(resources.reservedBuyCash.toString()).toBe('100');
    expect(resources.availableCash.toString()).toBe('9400');
    expect(instrumentResources(resources)).toEqual({
      instrumentId: INSTRUMENT_ID,
      executedQuantity: 5,
      sellReservedQuantity: 3,
      availableQuantity: 2,
    });
  });

  it('persists REJECTED orders without execution or reservation effects', async () => {
    const userId = await createAccount();
    await insertCashIn(userId, 10_000);
    const repository = new PostgresPreparedOrderRepository(pool!, userId);

    await repository.insert(
      preparedOrder({
        idempotencyKey: randomUUID(),
        intent: marketIntent({ side: 'BUY', size: '5' }),
        size: 5,
        price: '100',
        status: 'FILLED',
      }),
    );
    const before = await readResources(userId);
    const rejectedBuy = await repository.insert(
      preparedOrder({
        idempotencyKey: randomUUID(),
        intent: marketIntent({ side: 'BUY', size: '4' }),
        size: 4,
        price: '100',
        status: 'REJECTED',
      }),
    );
    const rejectedSell = await repository.insert(
      preparedOrder({
        idempotencyKey: randomUUID(),
        intent: marketIntent({ side: 'SELL', size: '2' }),
        size: 2,
        price: '120',
        status: 'REJECTED',
      }),
    );

    expect(await readResources(userId)).toEqual(before);
    expect(await readOrder(rejectedBuy.id)).toMatchObject({
      status: 'REJECTED',
      size: 4,
    });
    expect(await readOrder(rejectedSell.id)).toMatchObject({
      status: 'REJECTED',
      size: 2,
    });
    expect(instrumentResources(before)).toEqual({
      instrumentId: INSTRUMENT_ID,
      executedQuantity: 5,
      sellReservedQuantity: 0,
      availableQuantity: 5,
    });
  });
});

function marketIntent(
  overrides: Partial<OrderIntentInput> = {},
): OrderIntent {
  return createOrderIntent({
    instrumentId: INSTRUMENT_ID,
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
    instrumentId: INSTRUMENT_ID,
    side: 'BUY',
    type: 'LIMIT',
    size: '10',
    limitPrice: '10.10',
    ...overrides,
  });
}

function preparedOrder(
  overrides: Partial<PreparedOrderInput> = {},
): PreparedOrder {
  return createPreparedOrder({
    idempotencyKey: randomUUID(),
    intent: marketIntent(),
    size: 10,
    price: '100',
    status: 'FILLED',
    datetime: DATETIME,
    ...overrides,
  });
}

async function createAccount(): Promise<number> {
  const userId = nextUserId;
  nextUserId += 1;
  await pool!.query('INSERT INTO users (id) VALUES ($1)', [userId]);

  return userId;
}

async function insertCashIn(userId: number, amount: number): Promise<void> {
  await pool!.query(
    `INSERT INTO orders
       (instrumentid, userid, size, price, side, status, type, datetime)
     VALUES ($1, $2, $3, NULL, 'CASH_IN', 'FILLED', 'MARKET', $4)`,
    [CASH_INSTRUMENT_ID, userId, amount, DATETIME],
  );
}

async function readOrder(id: number): Promise<OrderRow> {
  const result = await pool!.query<OrderRow>(
    `SELECT id,
            instrumentid,
            userid,
            size,
            price::text AS price,
            type,
            side,
            status,
            datetime::text AS datetime,
            idempotency_key::text AS idempotency_key,
            idempotency_metadata
       FROM orders
      WHERE id = $1`,
    [id],
  );
  const row = result.rows[0];

  if (row === undefined) {
    throw new Error('Prepared order fixture was not found.');
  }

  return row;
}

async function countByKey(userId: number, key: string): Promise<number> {
  const result = await pool!.query<{ count: number }>(
    `SELECT count(*)::int AS count
       FROM orders
      WHERE userid = $1
        AND idempotency_key = $2::uuid`,
    [userId, key],
  );

  return result.rows[0]?.count ?? 0;
}

async function readResources(userId: number): Promise<AccountResources> {
  return calculateAccountResources(await movements.findByUserId(userId));
}

function instrumentResources(resources: AccountResources) {
  const found = resources.instruments.find(
    (instrument) => instrument.instrumentId === INSTRUMENT_ID,
  );

  if (found === undefined) {
    throw new Error('The fixture instrument has no resources.');
  }

  return found;
}

async function replayOrInsert(
  runner: AccountTransactionRunner,
  userId: number,
  key: string,
  intent: OrderIntent,
  prepared: PreparedOrder,
): Promise<AccountTransactionResult<ReplayOrInsertValue>> {
  return runner.run<ReplayOrInsertValue>(userId, async (context) => {
    const resolution = await resolveOrderReplay(
      context.persistedOrders,
      { userId, idempotencyKey: key, intent },
    );

    if (resolution.outcome === 'absent') {
      return {
        outcome: 'created',
        order: await context.preparedOrders.insert(prepared),
      };
    }

    if (resolution.outcome === 'conflict') {
      return { outcome: 'conflict', order: null };
    }

    return { outcome: 'match', order: resolution.order };
  });
}
