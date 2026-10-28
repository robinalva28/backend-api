import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { Pool, type PoolClient } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { PersistedOrderRepository } from '../../src/orders/application/ports/out/persisted-order.repository.js';
import { resolveOrderReplay } from '../../src/orders/application/resolve-order-replay.js';
import { buildOrderIntentMetadata } from '../../src/orders/domain/order-intent-metadata.js';
import {
  createOrderIntent,
  type OrderIntent,
} from '../../src/orders/domain/order-intent.js';
import { OrderIntentError } from '../../src/orders/domain/order-intent.error.js';
import type {
  PersistedOrder,
  PersistedOrderStatus,
} from '../../src/orders/domain/persisted-order.js';
import {
  PostgresPersistedOrderRepository,
  type PostgresQueryable,
} from '../../src/orders/infrastructure/persistence/postgres-persisted-order.repository.js';
import type { AccountTransactionResult } from '../../src/transactions/application/ports/out/account-transaction.port.js';
import { PostgresAccountTransactionRunner } from '../../src/transactions/infrastructure/persistence/postgres-account-transaction.runner.js';
import { RecordingConnectionPool } from '../support/recording-pool.js';
import { testDatabaseConfig } from '../support/test-database.js';

const SCHEMA = 'b04d_test';
const USER_A = 4401;
const USER_B = 4402;
const USER_C = 4403;
const SHARED_KEY = '11111111-1111-4111-8111-111111111111';

const INTENT: OrderIntent = createOrderIntent({
  instrumentId: 47,
  side: 'BUY',
  type: 'MARKET',
  size: '10',
  amount: null,
  limitPrice: null,
});
const DIFFERENT_INTENT: OrderIntent = createOrderIntent({
  instrumentId: 47,
  side: 'BUY',
  type: 'MARKET',
  size: '11',
  amount: null,
  limitPrice: null,
});
const METADATA = buildOrderIntentMetadata(INTENT);

interface FixtureRow {
  id: number;
  userid: number;
  status: string;
  idempotency_key: string;
  idempotency_metadata: unknown;
}

interface ConcurrentReplayResult {
  readonly order: PersistedOrder | null;
  readonly waitingWorkCalls: number;
}

let adminPool: Pool | undefined;
let pool: Pool | undefined;
let adapter: PersistedOrderRepository;

beforeAll(async () => {
  const migrationSql = await readFile(
    resolve(
      process.cwd(),
      'db/migrations/20261028-b04b-order-idempotency.sql',
    ),
    'utf8',
  );
  const config = testDatabaseConfig();
  adminPool = new Pool({ ...config, max: 1 });
  await adminPool.query(`DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE`);
  await adminPool.query(`CREATE SCHEMA ${SCHEMA}`);
  await adminPool.query(
    `CREATE TABLE ${SCHEMA}.users (id INT PRIMARY KEY)`,
  );
  await adminPool.query(
    `CREATE TABLE ${SCHEMA}.orders (
       id SERIAL PRIMARY KEY,
       instrumentId INT,
       userId INT,
       size INT,
       price NUMERIC(10, 2),
       type VARCHAR(10),
       side VARCHAR(10),
       status VARCHAR(20),
       datetime TIMESTAMP
     )`,
  );

  await adminPool.query('BEGIN');
  try {
    await adminPool.query(`SET LOCAL search_path TO ${SCHEMA}, public`);
    await adminPool.query(migrationSql);
    await adminPool.query('COMMIT');
  } catch (error) {
    await adminPool.query('ROLLBACK');
    throw error;
  }

  pool = new Pool({
    ...config,
    max: 4,
    options: `-c search_path=${SCHEMA},public`,
  });
  const searchPath = await pool.query<{ search_path: string }>(
    'SHOW search_path',
  );
  expect(searchPath.rows[0]?.search_path).toContain(SCHEMA);

  await pool.query(
    'INSERT INTO users (id) VALUES ($1), ($2), ($3)',
    [USER_A, USER_B, USER_C],
  );
  adapter = new PostgresPersistedOrderRepository(pool);
});

afterAll(async () => {
  await pool?.end();
  await adminPool?.query(`DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE`);
  await adminPool?.end();
});

describe('persisted order replay against PostgreSQL', () => {
  it('retrieves the same key independently for each account', async () => {
    const key = randomUUID();
    const firstId = await insertOrder(pool!, USER_A, key, METADATA, 'NEW');
    const secondId = await insertOrder(
      pool!,
      USER_B,
      key,
      buildOrderIntentMetadata(DIFFERENT_INTENT),
      'CANCELLED',
    );

    const first = await adapter.findByUserIdAndIdempotencyKey(USER_A, key);
    const second = await adapter.findByUserIdAndIdempotencyKey(USER_B, key);

    expect(first).toMatchObject({
      id: firstId,
      userId: USER_A,
      idempotencyKey: key,
      status: 'NEW',
    });
    expect(second).toMatchObject({
      id: secondId,
      userId: USER_B,
      idempotencyKey: key,
      status: 'CANCELLED',
    });

    await expect(
      resolveOrderReplay(adapter, {
        userId: USER_A,
        idempotencyKey: key,
        intent: INTENT,
      }),
    ).resolves.toMatchObject({ outcome: 'match', order: { id: firstId } });
    await expect(
      resolveOrderReplay(adapter, {
        userId: USER_B,
        idempotencyKey: key,
        intent: DIFFERENT_INTENT,
      }),
    ).resolves.toMatchObject({ outcome: 'match', order: { id: secondId } });
  });

  it.each(['NEW', 'FILLED', 'REJECTED', 'CANCELLED'] as const)(
    'recovers the current %s status without effects',
    async (status) => {
      const key = randomUUID();
      const id = await insertOrder(pool!, USER_A, key, METADATA, status);
      const before = await readRow(pool!, id);

      const resolution = await resolveOrderReplay(adapter, {
        userId: USER_A,
        idempotencyKey: key,
        intent: INTENT,
      });

      expect(resolution).toMatchObject({
        outcome: 'match',
        order: { id, status },
      });
      expect(await readRow(pool!, id)).toEqual(before);
    },
  );

  it('reports absence without creating an order', async () => {
    const key = randomUUID();

    await expect(
      resolveOrderReplay(adapter, {
        userId: USER_A,
        idempotencyKey: key,
        intent: INTENT,
      }),
    ).resolves.toEqual({ outcome: 'absent' });

    const count = await pool!.query<{ count: number }>(
      'SELECT count(*)::int AS count FROM orders WHERE idempotency_key = $1',
      [key],
    );
    expect(count.rows[0]?.count).toBe(0);
  });

  it('reports a conflict while preserving the original row', async () => {
    const key = randomUUID();
    const id = await insertOrder(pool!, USER_A, key, METADATA, 'NEW');
    const before = await readRow(pool!, id);

    await expect(
      resolveOrderReplay(adapter, {
        userId: USER_A,
        idempotencyKey: key,
        intent: DIFFERENT_INTENT,
      }),
    ).resolves.toEqual({ outcome: 'conflict' });

    expect(await readRow(pool!, id)).toEqual(before);
  });

  it.each([
    [
      'semantically incomplete metadata',
      { version: 1, parameters: {} },
      'invalid-metadata',
    ],
    [
      'unknown metadata version',
      { version: 2, parameters: {} },
      'unsupported-metadata-version',
    ],
  ] as const)(
    'propagates %s and preserves the original row',
    async (_label, invalidMetadata, code) => {
      const key = randomUUID();
      const id = await insertOrder(
        pool!,
        USER_A,
        key,
        invalidMetadata,
        'NEW',
      );
      const before = await readRow(pool!, id);

      let caught: unknown;

      try {
        await resolveOrderReplay(adapter, {
          userId: USER_A,
          idempotencyKey: key,
          intent: INTENT,
        });
      } catch (error) {
        caught = error;
      }

      expect(caught).toBeInstanceOf(OrderIntentError);
      expect(caught).toMatchObject({ code });
      expect(await readRow(pool!, id)).toEqual(before);
    },
  );

  it('reads uncommitted rows through the transaction context client', async () => {
    const key = randomUUID();
    const recorder = new RecordingConnectionPool(pool!);
    const runner = new PostgresAccountTransactionRunner(recorder);

    const result = await runner.run(USER_A, async (context) => {
      const inserted = await recorder.latest.query<{ id: number }>(
        `INSERT INTO orders
           (userId, status, idempotency_key, idempotency_metadata)
         VALUES ($1, 'NEW', $2, $3::jsonb)
         RETURNING id`,
        [USER_A, key, JSON.stringify(METADATA)],
      );
      const found = await context.persistedOrders.findByUserIdAndIdempotencyKey(
        USER_A,
        key,
      );

      return {
        insertedId: inserted.rows[0]?.id,
        found,
      };
    });

    expect(result.status).toBe('committed');

    if (result.status !== 'committed') {
      throw new Error('Expected a committed transaction.');
    }

    expect(result.value.insertedId).toBeDefined();
    expect(result.value.found?.id).toBe(result.value.insertedId);
    expect(result.value.found?.status).toBe('NEW');
  });

  it('sees the status confirmed by the lock holder after waiting', async () => {
    const key = randomUUID();
    const id = await insertOrder(pool!, USER_C, key, METADATA, 'NEW');

    const result = await runConcurrentReplay(pool!, USER_C, key);

    expect(result.waitingWorkCalls).toBe(1);
    expect(result.order?.id).toBe(id);
    expect(result.order?.status).toBe('CANCELLED');
    expect((await readRow(pool!, id)).status).toBe('CANCELLED');
  });
});

async function insertOrder(
  queryable: PostgresQueryable,
  userId: number,
  idempotencyKey: string,
  metadata: unknown,
  status: PersistedOrderStatus,
): Promise<number> {
  const result = await queryable.query<{ id: number }>(
    `INSERT INTO orders
       (userId, status, idempotency_key, idempotency_metadata)
     VALUES ($1, $2, $3, $4::jsonb)
     RETURNING id`,
    [userId, status, idempotencyKey, JSON.stringify(metadata)],
  );
  const id = result.rows[0]?.id;

  if (id === undefined) {
    throw new Error('Order insertion did not return an id.');
  }

  return id;
}

async function readRow(target: Pool, id: number): Promise<FixtureRow> {
  const result = await target.query<FixtureRow>(
    `SELECT id,
            userid,
            status,
            idempotency_key::text AS idempotency_key,
            idempotency_metadata
       FROM orders
      WHERE id = $1`,
    [id],
  );
  const row = result.rows[0];

  if (row === undefined) {
    throw new Error('Fixture order was not found.');
  }

  return row;
}

interface Deferred<T> {
  readonly promise: Promise<T>;
  resolve: (value: T | PromiseLike<T>) => void;
  reject: (reason?: unknown) => void;
}

function deferred<T>(): Deferred<T> {
  let resolve: (value: T | PromiseLike<T>) => void = () => undefined;
  let reject: (reason?: unknown) => void = () => undefined;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });

  return { promise, resolve, reject };
}

async function withTimeout<T>(
  promise: Promise<T>,
  milliseconds: number,
  message: string,
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;

  try {
    return await Promise.race([
      promise,
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => reject(new Error(message)), milliseconds);
      }),
    ]);
  } finally {
    if (timer !== undefined) {
      clearTimeout(timer);
    }
  }
}

async function assertAccountRowLocked(
  target: Pool,
  userId: number,
): Promise<void> {
  const client = await target.connect();

  try {
    await client.query('BEGIN');
    let rejected = false;

    try {
      await client.query(
        'SELECT id FROM users WHERE id = $1 FOR UPDATE NOWAIT',
        [userId],
      );
    } catch (error) {
      expect(error).toMatchObject({ code: '55P03' });
      rejected = true;
    } finally {
      await client.query('ROLLBACK');
    }

    expect(rejected).toBe(true);
  } finally {
    client.release();
  }
}

async function waitForLockWaiter(
  target: Pool,
  blockerPid: number,
): Promise<void> {
  const deadline = Date.now() + 2_000;

  while (Date.now() < deadline) {
    const waiter = await target.query<{ pid: number }>(
      `SELECT pid
         FROM pg_stat_activity
        WHERE datname = current_database()
          AND wait_event_type = 'Lock'
          AND $1 = ANY(pg_blocking_pids(pid))`,
      [blockerPid],
    );

    if (waiter.rows.length > 0) {
      return;
    }

    await new Promise((resolveDelay) => setTimeout(resolveDelay, 10));
  }

  throw new Error(
    `No PostgreSQL backend was waiting on the account held by ${blockerPid}.`,
  );
}

async function runConcurrentReplay(
  target: Pool,
  userId: number,
  key: string,
): Promise<ConcurrentReplayResult> {
  const recorderA = new RecordingConnectionPool(target);
  const recorderB = new RecordingConnectionPool(target);
  const runnerA = new PostgresAccountTransactionRunner(recorderA);
  const runnerB = new PostgresAccountTransactionRunner(recorderB);
  const lockHeld = deferred<void>();
  const releaseA = deferred<void>();
  let waitingWorkCalls = 0;
  let lockHolderPid = 0;
  let runA: Promise<AccountTransactionResult<string>> | undefined;
  let runB: Promise<AccountTransactionResult<PersistedOrder | null>> | undefined;
  let primaryError: unknown;
  let cleanupError: unknown;
  let settlement:
    | PromiseSettledResult<AccountTransactionResult<unknown>>[]
    | undefined;

  try {
    runA = runnerA.run(userId, async () => {
      const pid = await recorderA.latest.query<{ pid: number }>(
        'SELECT pg_backend_pid() AS pid',
        [],
      );
      lockHolderPid = pid.rows[0]?.pid ?? 0;
      await recorderA.latest.query(
        `UPDATE orders
            SET status = 'CANCELLED'
          WHERE userid = $1
            AND idempotency_key = $2`,
        [userId, key],
      );
      lockHeld.resolve();
      await releaseA.promise;

      return 'first-operation';
    });
    void runA.catch(() => undefined);

    await withTimeout(lockHeld.promise, 2_000, 'Account lock was not acquired.');
    expect(lockHolderPid).toBeGreaterThan(0);
    await assertAccountRowLocked(target, userId);

    runB = runnerB.run(userId, async (context) => {
      waitingWorkCalls += 1;
      const order =
        await context.persistedOrders.findByUserIdAndIdempotencyKey(
          userId,
          key,
        );

      return order;
    });
    void runB.catch(() => undefined);

    await waitForLockWaiter(target, lockHolderPid);
    expect(waitingWorkCalls).toBe(0);
  } catch (error) {
    primaryError = error;
  } finally {
    releaseA.resolve();
  }

  try {
    settlement = await withTimeout(
      Promise.allSettled([
        ...(runA === undefined ? [] : [runA]),
        ...(runB === undefined ? [] : [runB]),
      ]),
      2_000,
      'Concurrent replay operations did not settle during cleanup.',
    );
  } catch (error) {
    cleanupError = error;
  }

  if (primaryError !== undefined) {
    throw primaryError;
  }

  if (cleanupError !== undefined) {
    throw cleanupError;
  }

  if (settlement === undefined || settlement.length !== 2) {
    throw new Error('Both concurrent replay operations must settle.');
  }

  const rejected = settlement.find(
    (outcome): outcome is PromiseRejectedResult => outcome.status === 'rejected',
  );

  if (rejected !== undefined) {
    throw rejected.reason;
  }

  const waiting = settlement[1];

  if (waiting?.status !== 'fulfilled') {
    throw new Error('The waiting replay operation did not settle.');
  }

  if (waiting.value.status !== 'committed') {
    throw new Error('The waiting replay operation did not commit.');
  }

  return {
    order: waiting.value.value as PersistedOrder | null,
    waitingWorkCalls,
  };
}
