import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import type { Pool } from 'pg';
import { Pool as PostgresPool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { CancelOrderService } from '../../src/orders/application/cancel-order.service.js';
import { OrderReplayRecoveryService } from '../../src/orders/application/order-replay-recovery.service.js';
import { RetryingSubmitOrderRunner } from '../../src/orders/application/retrying-submit-order.runner.js';
import { SubmitOrderService } from '../../src/orders/application/submit-order.service.js';
import { SubmitOrderError } from '../../src/orders/application/errors/submit-order.error.js';
import { buildOrderIntentMetadata } from '../../src/orders/domain/order-intent-metadata.js';
import {
  createOrderIntent,
  type OrderIntent,
  type OrderIntentInput,
} from '../../src/orders/domain/order-intent.js';
import type { AccountResources } from '../../src/resources/domain/account-resources.js';
import { calculateAccountResources } from '../../src/resources/domain/calculate-account-resources.js';
import { PostgresAccountMovementRepository } from '../../src/resources/infrastructure/persistence/postgres-account-movement.repository.js';
import { PostgresAccountTransactionRunner } from '../../src/transactions/infrastructure/persistence/postgres-account-transaction.runner.js';
import {
  FaultInjectingPool,
  type FaultInjectingPoolClient,
} from '../support/fault-injecting-pool.js';
import { testDatabaseConfig } from '../support/test-database.js';

const SCHEMA = 'b08b_test';
const ACTION_ID = 9801;
const CASH_ID = 9802;
const FIXED_DATE = new Date('2026-10-29T20:15:30.456Z');
const FIXED_DATETIME = '2026-10-29 20:15:30.456';

interface OrderRow {
  id: number;
  userid: number;
  status: string;
  instrumentid: number;
  size: number;
  price: string;
  type: string;
  side: string;
}

let adminPool: Pool | undefined;
let pool: Pool | undefined;
let rawSubmit: SubmitOrderService;
let nextUserId = 9821;

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
  adminPool = new PostgresPool({ ...config, max: 1 });
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

  pool = new PostgresPool({
    ...config,
    max: 8,
    options: `-c search_path=${SCHEMA}`,
  });
  await pool.query(
    `INSERT INTO instruments (id, ticker, name, type)
     VALUES ($1, 'B08B', 'B08B action fixture', 'ACCIONES'),
            ($2, 'B08BCASH', 'B08B cash fixture', 'MONEDA')`,
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

  rawSubmit = new SubmitOrderService(
    new PostgresAccountTransactionRunner(pool),
    { now: () => new Date(FIXED_DATE) },
    {
      recover: async () => {
        throw new Error('Raw fixture submission does not recover.');
      },
    },
  );
});

afterAll(async () => {
  try {
    await pool?.end();
  } finally {
    await adminPool?.query(`DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE`);
    await adminPool?.end();
  }
});

describe('Single uncertain-COMMIT recovery against PostgreSQL', () => {
  it('recovers a real confirmed COMMIT after its response is lost without duplicating effects', async () => {
    const userId = await createAccount(10_000);
    const key = randomUUID();
    const intent = marketIntent({ size: '10' });
    const faults = new FaultInjectingPool(pool!);
    faults.commitFault = 'lose-response-after-commit';
    const waits: number[] = [];
    const { service } = createService(faults, waits);

    const output = await service.execute({ userId, idempotencyKey: key, intent });

    expect(output).toMatchObject({ status: 'FILLED', replayed: true });
    expect(waits).toEqual([]);
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

    expect(faults.clients).toHaveLength(2);
    expect(faults.clients[0]).not.toBe(faults.clients[1]);

    const initial = faults.clients[0]!;
    const recovery = faults.clients[1]!;

    expect(commands(initial)).toEqual({
      begin: 1,
      lock: 1,
      commit: 1,
      rollback: 1,
    });
    expect(commands(recovery)).toEqual({
      begin: 1,
      lock: 1,
      commit: 1,
      rollback: 0,
    });
    expectOrderReadAfterLock(recovery);
    expectNoRecoveryWritesOrMarketReads(recovery);
  });

  it('returns the generic completion failure when the uncertain attempt left no row', async () => {
    const userId = await createAccount(1_000);
    const key = randomUUID();
    const intent = limitIntent({ size: '2', limitPrice: '100' });
    const faults = new FaultInjectingPool(pool!);
    faults.commitFault = 'fail-before-commit';
    const { service } = createService(faults);

    let caught: unknown;

    try {
      await service.execute({ userId, idempotencyKey: key, intent });
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(SubmitOrderError);
    expect(caught).toMatchObject({ code: 'completion-failed' });
    expect(await countByKey(userId, key)).toBe(0);
    expect(faults.clients).toHaveLength(2);
    expect(commands(faults.clients[1]!)).toEqual({
      begin: 1,
      lock: 1,
      commit: 1,
      rollback: 0,
    });
    expectOrderReadAfterLock(faults.clients[1]!);
    expectNoRecoveryWritesOrMarketReads(faults.clients[1]!);

    const resources = await resourcesFor(userId);
    expect(resources.accountingCash.toString()).toBe('1000');
    expect(resources.reservedBuyCash.toString()).toBe('0');
    expect(resources.availableCash.toString()).toBe('1000');
    expect(resources.instruments).toEqual([]);
  });

  it('recovers the current CANCELLED state changed between confirmation and query', async () => {
    const userId = await createAccount(1_000);
    const key = randomUUID();
    const intent = limitIntent({ size: '2', limitPrice: '100' });
    const faults = new FaultInjectingPool(pool!);
    faults.commitFault = 'lose-response-after-commit';
    let confirmedOrderId: number | undefined;
    faults.afterCommitted = async () => {
      const row = await readOrderByKey(userId, key);

      if (row === undefined) {
        throw new Error('The confirmed order was not found.');
      }

      confirmedOrderId = row.id;
      await new CancelOrderService(
        new PostgresAccountTransactionRunner(pool!),
      ).execute({ userId, orderId: row.id });
    };
    const { service } = createService(faults);

    const output = await service.execute({ userId, idempotencyKey: key, intent });

    expect(output).toEqual({
      orderId: confirmedOrderId,
      status: 'CANCELLED',
      replayed: true,
    });
    expect(await countByKey(userId, key)).toBe(1);
    expect(await readOrderByKey(userId, key)).toMatchObject({
      status: 'CANCELLED',
      size: 2,
      price: '100.00',
    });

    const resources = await resourcesFor(userId);
    expect(resources.accountingCash.toString()).toBe('1000');
    expect(resources.reservedBuyCash.toString()).toBe('0');
    expect(resources.availableCash.toString()).toBe('1000');
    expect(resources.instruments).toEqual([]);
    expectNoRecoveryWritesOrMarketReads(faults.clients[1]!);
  });

  it('keeps the same UUID isolated by user during recovery', async () => {
    const firstUserId = await createAccount(10_000);
    const secondUserId = await createAccount(10_000);
    const key = randomUUID();
    const intent = marketIntent({ size: '1' });
    const second = await rawSubmit.execute({
      userId: secondUserId,
      idempotencyKey: key,
      intent,
    });
    const faults = new FaultInjectingPool(pool!);
    faults.commitFault = 'lose-response-after-commit';
    const { service } = createService(faults);

    const first = await service.execute({
      userId: firstUserId,
      idempotencyKey: key,
      intent,
    });

    expect(first.orderId).not.toBe(second.orderId);
    expect(first.status).toBe('FILLED');
    expect(await countByKey(firstUserId, key)).toBe(1);
    expect(await countByKey(secondUserId, key)).toBe(1);
    const recoveryRead = faults.clients[1]!.queries.find(
      ({ text }) => text.includes('FROM orders') && text.includes('idempotency_key'),
    );
    expect(recoveryRead?.values).toEqual([firstUserId, key]);
  });

  it('returns the approved conflict when the recovered intent differs', async () => {
    const userId = await createAccount(10_000);
    const key = randomUUID();
    const intent = marketIntent({ size: '1' });
    const faults = new FaultInjectingPool(pool!);
    faults.commitFault = 'lose-response-after-commit';
    faults.afterCommitted = async () => {
      const row = await readOrderByKey(userId, key);

      if (row === undefined) {
        throw new Error('The confirmed order was not found.');
      }

      await pool!.query(
        `UPDATE orders
            SET idempotency_metadata = $2::jsonb
          WHERE id = $1`,
        [row.id, JSON.stringify(buildOrderIntentMetadata(marketIntent({ size: '2' })))],
      );
    };
    const { service } = createService(faults);

    let caught: unknown;

    try {
      await service.execute({ userId, idempotencyKey: key, intent });
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(SubmitOrderError);
    expect(caught).toMatchObject({ code: 'conflict' });
    expect(await countByKey(userId, key)).toBe(1);
    expect(await readOrderByKey(userId, key)).toMatchObject({
      status: 'FILLED',
      size: 1,
    });

    const resources = await resourcesFor(userId);
    expect(resources.accountingCash.toString()).toBe('9700');
    expect(resources.reservedBuyCash.toString()).toBe('0');
    expectNoRecoveryWritesOrMarketReads(faults.clients[1]!);
  });

  it('stops with the generic failure when the single recovery connection fails', async () => {
    const userId = await createAccount(10_000);
    const key = randomUUID();
    const intent = marketIntent({ size: '1' });
    const faults = new FaultInjectingPool(pool!);
    faults.commitFault = 'lose-response-after-commit';
    faults.failConnectionAfterFirst = true;
    const { service } = createService(faults);

    let caught: unknown;

    try {
      await service.execute({ userId, idempotencyKey: key, intent });
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(SubmitOrderError);
    expect(caught).toMatchObject({ code: 'completion-failed' });
    expect((caught as Error).cause).toMatchObject({
      stage: 'connection',
      commitOutcome: 'not-attempted',
    });
    expect(faults.connectCalls).toBe(2);
    expect(faults.clients).toHaveLength(1);
    expect(await countByKey(userId, key)).toBe(1);
    expect((await resourcesFor(userId)).accountingCash.toString()).toBe('9700');
  });

  it('preserves the B08-A retry budget before a subsequent uncertain COMMIT and recovers once', async () => {
    const userId = await createAccount(10_000);
    const key = randomUUID();
    const intent = marketIntent({ size: '2' });
    const faults = new FaultInjectingPool(pool!);
    faults.failFirstOrderInsertWith = '40001';
    faults.commitFault = 'lose-response-after-commit';
    const waits: number[] = [];
    const { service } = createService(faults, waits);

    const output = await service.execute({ userId, idempotencyKey: key, intent });

    expect(output).toMatchObject({ status: 'FILLED', replayed: true });
    expect(waits).toEqual([50]);
    expect(await countByKey(userId, key)).toBe(1);
    expect(faults.clients).toHaveLength(3);
    expect(commands(faults.clients[0]!)).toEqual({
      begin: 1,
      lock: 1,
      commit: 0,
      rollback: 1,
    });
    expect(commands(faults.clients[1]!)).toEqual({
      begin: 1,
      lock: 1,
      commit: 1,
      rollback: 1,
    });
    expect(commands(faults.clients[2]!)).toEqual({
      begin: 1,
      lock: 1,
      commit: 1,
      rollback: 0,
    });
    expectNoRecoveryWritesOrMarketReads(faults.clients[2]!);

    const resources = await resourcesFor(userId);
    expect(resources.accountingCash.toString()).toBe('9400');
    expect(resources.reservedBuyCash.toString()).toBe('0');
    expect(instrumentResources(resources, ACTION_ID)).toEqual({
      instrumentId: ACTION_ID,
      executedQuantity: 2,
      sellReservedQuantity: 0,
      availableQuantity: 2,
    });
  });
});

function createService(
  faults: FaultInjectingPool,
  waits: number[] = [],
): { readonly service: SubmitOrderService } {
  const runner = new PostgresAccountTransactionRunner(faults);
  const recovery = new OrderReplayRecoveryService(runner);
  const retrying = new RetryingSubmitOrderRunner(runner, async (milliseconds) => {
    waits.push(milliseconds);
  });

  return {
    service: new SubmitOrderService(
      retrying,
      { now: () => new Date(FIXED_DATE) },
      recovery,
    ),
  };
}

function commands(client: FaultInjectingPoolClient): {
  begin: number;
  lock: number;
  commit: number;
  rollback: number;
} {
  const texts = client.queries.map(({ text }) => text);

  return {
    begin: texts.filter((text) => text.startsWith('BEGIN TRANSACTION')).length,
    lock: texts.filter(
      (text) => text.includes('FROM users') && text.includes('FOR UPDATE'),
    ).length,
    commit: texts.filter((text) => text === 'COMMIT').length,
    rollback: texts.filter((text) => text === 'ROLLBACK').length,
  };
}

function expectOrderReadAfterLock(client: FaultInjectingPoolClient): void {
  const lockIndex = client.queries.findIndex(
    ({ text }) => text.includes('FROM users') && text.includes('FOR UPDATE'),
  );
  const orderReadIndex = client.queries.findIndex(
    ({ text }) => text.includes('FROM orders') && text.includes('idempotency_key'),
  );

  expect(lockIndex).toBeGreaterThanOrEqual(0);
  expect(orderReadIndex).toBeGreaterThan(lockIndex);
}

function expectNoRecoveryWritesOrMarketReads(
  client: FaultInjectingPoolClient,
): void {
  const writes = client.queries.filter(({ text }) =>
    /^\s*(INSERT|UPDATE|DELETE)\b/i.test(text),
  );
  const marketReads = client.queries.filter(
    ({ text }) =>
      text.includes('FROM instruments') || text.includes('FROM marketdata'),
  );

  expect(writes).toEqual([]);
  expect(marketReads).toEqual([]);
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
    `SELECT id, userid, status, instrumentid, size, price::text AS price, type, side
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
