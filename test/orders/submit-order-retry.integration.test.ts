import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import type {
  PoolClient,
  QueryResult,
  QueryResultRow,
} from 'pg';
import { Pool } from 'pg';
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
} from 'vitest';
import { CancelOrderService } from '../../src/orders/application/cancel-order.service.js';
import { RetryingSubmitOrderRunner } from '../../src/orders/application/retrying-submit-order.runner.js';
import { SubmitOrderService } from '../../src/orders/application/submit-order.service.js';
import {
  createOrderIntent,
  type OrderIntent,
  type OrderIntentInput,
} from '../../src/orders/domain/order-intent.js';
import { PostgresAccountMovementRepository } from '../../src/resources/infrastructure/persistence/postgres-account-movement.repository.js';
import { calculateAccountResources } from '../../src/resources/domain/calculate-account-resources.js';
import type { AccountResources } from '../../src/resources/domain/account-resources.js';
import { AccountTransactionError } from '../../src/transactions/application/errors/account-transaction.error.js';
import { PostgresAccountTransactionRunner } from '../../src/transactions/infrastructure/persistence/postgres-account-transaction.runner.js';
import type {
  PostgresConnectionPool,
  PostgresTransactionClient,
} from '../../src/transactions/infrastructure/persistence/postgres-account-transaction.runner.js';
import { NeverSubmitOrderRecovery } from '../support/never-recovery.js';
import { testDatabaseConfig } from '../support/test-database.js';

const SCHEMA = 'b08a_test';
const ACTION_ID = 9901;
const CASH_ID = 9902;
const FIXED_DATE = new Date('2026-10-29T15:45:12.345Z');
const FIXED_DATETIME = '2026-10-29 15:45:12.345';
const TRIGGER = 'b08a_fail_orders';
const FUNCTION = 'b08a_fail_orders_fn';
const SEQUENCE = 'b08a_attempts';

interface QueryRecord {
  readonly text: string;
  readonly values: unknown[];
}

class RecordingClient implements PostgresTransactionClient {
  readonly queries: QueryRecord[] = [];

  constructor(private readonly inner: PoolClient) {}

  query<Row extends QueryResultRow>(
    text: string,
    values: unknown[],
  ): Promise<QueryResult<Row>> {
    this.queries.push({ text, values });

    return this.inner.query<Row>(text, values);
  }

  release(destroy?: boolean): void {
    this.inner.release(destroy);
  }
}

class RecordingTransactionPool implements PostgresConnectionPool {
  readonly clients: RecordingClient[] = [];

  constructor(private readonly pool: Pool) {}

  async connect(): Promise<PostgresTransactionClient> {
    const client = new RecordingClient(await this.pool.connect());
    this.clients.push(client);

    return client;
  }
}

interface OrderRow {
  id: number;
  status: string;
  instrumentid: number;
  size: number;
  price: string;
}

let adminPool: Pool | undefined;
let pool: Pool | undefined;
let rawSubmit: SubmitOrderService;
let cancelOrder: CancelOrderService;
let nextUserId = 9951;

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
     VALUES ($1, 'B08A', 'B08A action fixture', 'ACCIONES'),
            ($2, 'B08ACASH', 'B08A cash fixture', 'MONEDA')`,
    [ACTION_ID, CASH_ID],
  );
  await pool.query(
    `INSERT INTO marketdata
       (instrumentid, date, open, high, low, close, previousclose)
     VALUES
       ($1, '2023-07-13', 100.00, 100.00, 100.00, 100.00, 90.00),
       ($1, '2023-07-14', 300.00, 300.00, 300.00, 300.00, 100.00)`,
    [ACTION_ID],
  );

  const runner = new PostgresAccountTransactionRunner(pool);
  rawSubmit = new SubmitOrderService(
    runner,
    {
      now: () => new Date(FIXED_DATE),
    },
    new NeverSubmitOrderRecovery(),
  );
  cancelOrder = new CancelOrderService(runner);
});

afterAll(async () => {
  try {
    await pool?.end();
  } finally {
    await adminPool?.query(`DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE`);
    await adminPool?.end();
  }
});

beforeEach(async () => {
  await removeFailingTrigger();
});

afterEach(async () => {
  await removeFailingTrigger();
});

describe('SubmitOrderService retries against PostgreSQL', () => {
  it('rolls back an eligible work failure and repeats the full transaction once', async () => {
    const userId = await createAccount(10_000);
    const key = randomUUID();
    const intent = marketIntent({ size: '10' });
    await installFailingTrigger(
      `IF attempt = 1 THEN
         RAISE EXCEPTION 'forced serialization failure' USING ERRCODE = '40001';
       END IF;`,
      'AFTER',
    );
    const waits: number[] = [];
    const { service, recorder } = createRetryService((milliseconds) => {
      waits.push(milliseconds);

      return Promise.resolve();
    });

    const output = await service.execute({
      userId,
      idempotencyKey: key,
      intent,
    });

    expect(output).toMatchObject({ status: 'FILLED', replayed: false });
    expect(waits).toEqual([50]);
    expect(await attemptCount()).toBe(2);
    expect(await countByKey(userId, key)).toBe(1);
    expect(await readOrderByKey(userId, key)).toMatchObject({
      instrumentid: ACTION_ID,
      size: 10,
      price: '300.00',
      status: 'FILLED',
    });
    expect(await orderDatetime(userId, key)).toBe(FIXED_DATETIME);

    const resources = await resourcesFor(userId);
    expect(resources.accountingCash.toString()).toBe('7000');
    expect(resources.reservedBuyCash.toString()).toBe('0');
    expect(resources.availableCash.toString()).toBe('7000');
    expect(instrumentResources(resources, ACTION_ID)).toEqual({
      instrumentId: ACTION_ID,
      executedQuantity: 10,
      sellReservedQuantity: 0,
      availableQuantity: 10,
    });

    expect(recorder.clients).toHaveLength(2);
    expect(transactionCommands(recorder)).toEqual({
      begin: 2,
      lock: 2,
      rollback: 1,
      commit: 1,
    });
    expect(businessReads(recorder)).toEqual([
      {
        orders: expect.any(Number),
        instruments: expect.any(Number),
        marketdata: expect.any(Number),
      },
      {
        orders: expect.any(Number),
        instruments: expect.any(Number),
        marketdata: expect.any(Number),
      },
    ]);
  });

  it('recovers after the third eligible failure with 50, 100 and 200 ms waits', async () => {
    const userId = await createAccount(10_000);
    const key = randomUUID();
    const intent = marketIntent({ size: '2' });
    await installFailingTrigger(
      `IF attempt = 1 THEN
         RAISE EXCEPTION 'forced serialization failure' USING ERRCODE = '40001';
       ELSIF attempt = 2 THEN
         RAISE EXCEPTION 'forced deadlock' USING ERRCODE = '40P01';
       ELSIF attempt = 3 THEN
         RAISE EXCEPTION 'forced serialization failure' USING ERRCODE = '40001';
       END IF;`,
    );
    const waits: number[] = [];
    const { service } = createRetryService((milliseconds) => {
      waits.push(milliseconds);

      return Promise.resolve();
    });

    const output = await service.execute({
      userId,
      idempotencyKey: key,
      intent,
    });

    expect(output).toMatchObject({ status: 'FILLED', replayed: false });
    expect(waits).toEqual([50, 100, 200]);
    expect(await attemptCount()).toBe(4);
    expect(await countByKey(userId, key)).toBe(1);
    expect((await resourcesFor(userId)).accountingCash.toString()).toBe(
      '9400',
    );
  });

  it('exhausts four eligible attempts without an order or reservation', async () => {
    const userId = await createAccount(1_000);
    const key = randomUUID();
    const intent = limitIntent({ size: '2', limitPrice: '100' });
    await installFailingTrigger(
      `IF attempt <= 4 THEN
         RAISE EXCEPTION 'forced deadlock' USING ERRCODE = '40P01';
       END IF;`,
    );
    const waits: number[] = [];
    const { service } = createRetryService((milliseconds) => {
      waits.push(milliseconds);

      return Promise.resolve();
    });

    let caught: unknown;

    try {
      await service.execute({ userId, idempotencyKey: key, intent });
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(AccountTransactionError);
    expect(caught).toMatchObject({
      stage: 'work',
      commitOutcome: 'not-attempted',
      clientDisposition: 'released',
      transientFailure: 'deadlock',
      rollbackError: undefined,
      releaseError: undefined,
    });
    expect(waits).toEqual([50, 100, 200]);
    expect(await attemptCount()).toBe(4);
    expect(await countByKey(userId, key)).toBe(0);

    const resources = await resourcesFor(userId);
    expect(resources.accountingCash.toString()).toBe('1000');
    expect(resources.reservedBuyCash.toString()).toBe('0');
    expect(resources.availableCash.toString()).toBe('1000');
    expect(resources.instruments).toEqual([]);
  });

  it('recovers the current CANCELLED state confirmed between attempts', async () => {
    const userId = await createAccount(1_000);
    const key = randomUUID();
    const intent = limitIntent({ size: '2', limitPrice: '100' });
    await installFailingTrigger(
      `IF attempt = 1 THEN
         RAISE EXCEPTION 'forced serialization failure' USING ERRCODE = '40001';
       END IF;`,
    );
    let concurrentOrderId: number | undefined;
    let waitCalls = 0;
    const { service } = createRetryService(async (milliseconds) => {
      waitCalls += 1;
      expect(milliseconds).toBe(50);

      const created = await rawSubmit.execute({
        userId,
        idempotencyKey: key,
        intent,
      });
      concurrentOrderId = created.orderId;
      const cancelled = await cancelOrder.execute({
        userId,
        orderId: created.orderId,
      });

      expect(cancelled.status).toBe('CANCELLED');
    });

    const output = await service.execute({
      userId,
      idempotencyKey: key,
      intent,
    });

    expect(output).toEqual({
      orderId: concurrentOrderId,
      status: 'CANCELLED',
      replayed: true,
    });
    expect(waitCalls).toBe(1);
    expect(await attemptCount()).toBe(2);
    expect(await countByKey(userId, key)).toBe(1);
    expect(await readOrderByKey(userId, key)).toMatchObject({
      status: 'CANCELLED',
      price: '100.00',
      size: 2,
    });

    const resources = await resourcesFor(userId);
    expect(resources.accountingCash.toString()).toBe('1000');
    expect(resources.reservedBuyCash.toString()).toBe('0');
    expect(resources.availableCash.toString()).toBe('1000');
    expect(resources.instruments).toEqual([]);
  });

  it('stops after a non-eligible failure that follows an eligible one', async () => {
    const userId = await createAccount(10_000);
    const key = randomUUID();
    const intent = marketIntent({ size: '1' });
    await installFailingTrigger(
      `IF attempt = 1 THEN
         RAISE EXCEPTION 'forced serialization failure' USING ERRCODE = '40001';
       ELSIF attempt = 2 THEN
         RAISE EXCEPTION 'forced unique violation' USING ERRCODE = '23505';
       END IF;`,
    );
    const waits: number[] = [];
    const { service } = createRetryService((milliseconds) => {
      waits.push(milliseconds);

      return Promise.resolve();
    });

    let caught: unknown;

    try {
      await service.execute({ userId, idempotencyKey: key, intent });
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(AccountTransactionError);
    expect(caught).toMatchObject({
      stage: 'work',
      transientFailure: undefined,
      rollbackError: undefined,
      releaseError: undefined,
    });
    expect(waits).toEqual([50]);
    expect(await attemptCount()).toBe(2);
    expect(await countByKey(userId, key)).toBe(0);
    expect((await resourcesFor(userId)).accountingCash.toString()).toBe(
      '10000',
    );
  });
});

function createRetryService(
  wait: (milliseconds: number) => Promise<void>,
): {
  readonly service: SubmitOrderService;
  readonly recorder: RecordingTransactionPool;
} {
  const recorder = new RecordingTransactionPool(pool!);
  const runner = new PostgresAccountTransactionRunner(recorder);

  return {
    service: new SubmitOrderService(
      new RetryingSubmitOrderRunner(runner, wait),
      { now: () => new Date(FIXED_DATE) },
      new NeverSubmitOrderRecovery(),
    ),
    recorder,
  };
}

async function installFailingTrigger(
  failureBody: string,
  timing: 'BEFORE' | 'AFTER' = 'BEFORE',
): Promise<void> {
  await removeFailingTrigger();
  await pool!.query(`CREATE SEQUENCE ${SEQUENCE} START 1`);
  await pool!.query(`
    CREATE FUNCTION ${FUNCTION}() RETURNS trigger
    LANGUAGE plpgsql AS $$
    DECLARE
      attempt bigint;
    BEGIN
      attempt := nextval('${SEQUENCE}');
      ${failureBody}
      RETURN NEW;
    END;
    $$
  `);
  await pool!.query(`
    CREATE TRIGGER ${TRIGGER}
    ${timing} INSERT ON orders
    FOR EACH ROW
    EXECUTE FUNCTION ${FUNCTION}()
  `);
}

async function removeFailingTrigger(): Promise<void> {
  if (pool === undefined) {
    return;
  }

  await pool.query(`DROP TRIGGER IF EXISTS ${TRIGGER} ON orders`);
  await pool.query(`DROP FUNCTION IF EXISTS ${FUNCTION}()`);
  await pool.query(`DROP SEQUENCE IF EXISTS ${SEQUENCE}`);
}

async function attemptCount(): Promise<number> {
  const result = await pool!.query<{ value: number }>(
    `SELECT CASE WHEN is_called THEN last_value ELSE 0 END::int AS value
       FROM ${SEQUENCE}`,
  );

  return result.rows[0]?.value ?? 0;
}

async function createAccount(cash: number): Promise<number> {
  const userId = nextUserId;
  nextUserId += 1;
  await pool!.query('INSERT INTO users (id) VALUES ($1)', [userId]);
  await pool!.query(
    `INSERT INTO orders
       (instrumentid, userid, size, price, side, status, type, datetime)
     VALUES ($1, $2, $3, NULL, 'CASH_IN', 'FILLED', 'MARKET', $4)`,
    [CASH_ID, userId, cash, '2023-07-01 00:00:00'],
  );

  return userId;
}

async function resourcesFor(userId: number): Promise<AccountResources> {
  const movements = await new PostgresAccountMovementRepository(
    pool!,
  ).findByUserId(userId);

  return calculateAccountResources(movements);
}

function instrumentResources(
  resources: AccountResources,
  instrumentId: number,
): AccountResources['instruments'][number] | undefined {
  return resources.instruments.find(
    (instrument) => instrument.instrumentId === instrumentId,
  );
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

async function readOrderByKey(
  userId: number,
  key: string,
): Promise<OrderRow | undefined> {
  const result = await pool!.query<OrderRow>(
    `SELECT id, status, instrumentid, size, price::text AS price
       FROM orders
      WHERE userid = $1
        AND idempotency_key = $2::uuid`,
    [userId, key],
  );

  return result.rows[0];
}

async function orderDatetime(
  userId: number,
  key: string,
): Promise<string | undefined> {
  const result = await pool!.query<{ datetime: string }>(
    `SELECT to_char(datetime, 'YYYY-MM-DD HH24:MI:SS.MS') AS datetime
       FROM orders
      WHERE userid = $1
        AND idempotency_key = $2::uuid`,
    [userId, key],
  );

  return result.rows[0]?.datetime;
}

function marketIntent(overrides: Partial<OrderIntentInput> = {}): OrderIntent {
  return createOrderIntent({
    instrumentId: ACTION_ID,
    side: 'BUY',
    type: 'MARKET',
    size: '1',
    ...overrides,
  });
}

function limitIntent(overrides: Partial<OrderIntentInput> = {}): OrderIntent {
  return createOrderIntent({
    instrumentId: ACTION_ID,
    side: 'BUY',
    type: 'LIMIT',
    size: '1',
    limitPrice: '100.10',
    ...overrides,
  });
}

function transactionCommands(recorder: RecordingTransactionPool): {
  begin: number;
  lock: number;
  rollback: number;
  commit: number;
} {
  const texts = recorder.clients.flatMap((client) =>
    client.queries.map(({ text }) => text),
  );

  return {
    begin: texts.filter((text) => text.startsWith('BEGIN TRANSACTION')).length,
    lock: texts.filter(
      (text) => text.includes('FROM users') && text.includes('FOR UPDATE'),
    ).length,
    rollback: texts.filter((text) => text === 'ROLLBACK').length,
    commit: texts.filter((text) => text === 'COMMIT').length,
  };
}

function businessReads(recorder: RecordingTransactionPool): Array<{
  orders: number;
  instruments: number;
  marketdata: number;
}> {
  return recorder.clients.map((client) => ({
    orders: client.queries.filter(({ text }) => text.includes('FROM orders'))
      .length,
    instruments: client.queries.filter(({ text }) =>
      text.includes('FROM instruments'),
    ).length,
    marketdata: client.queries.filter(({ text }) =>
      text.includes('FROM marketdata'),
    ).length,
  }));
}
