import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import type { QueryResult, QueryResultRow } from 'pg';
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { CancelOrderService } from '../../src/orders/application/cancel-order.service.js';
import { CancelOrderError } from '../../src/orders/application/errors/cancel-order.error.js';
import { SubmitOrderService } from '../../src/orders/application/submit-order.service.js';
import { createOrderIntent, type OrderIntent } from '../../src/orders/domain/order-intent.js';
import type { AccountResources } from '../../src/resources/domain/account-resources.js';
import { calculateAccountResources } from '../../src/resources/domain/calculate-account-resources.js';
import { PostgresAccountMovementRepository } from '../../src/resources/infrastructure/persistence/postgres-account-movement.repository.js';
import { AccountTransactionError } from '../../src/transactions/application/errors/account-transaction.error.js';
import type {
  AccountTransactionContext,
  AccountTransactionResult,
  AccountTransactionRunner,
} from '../../src/transactions/application/ports/out/account-transaction.port.js';
import {
  PostgresAccountTransactionRunner,
  type PostgresConnectionPool,
  type PostgresTransactionClient,
} from '../../src/transactions/infrastructure/persistence/postgres-account-transaction.runner.js';
import { testDatabaseConfig } from '../support/test-database.js';

const SCHEMA = 'b06a_test';
const ACTION_ID = 9601;
const CASH_ID = 9602;
const FIXED_DATE = new Date('2026-10-28T20:15:30.456Z');
const FIXED_DATETIME = '2026-10-28 20:15:30.456';

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
  idempotency_key: string | null;
  idempotency_metadata: unknown;
  xmin: string;
}

interface InsertOrderOptions {
  readonly userId: number;
  readonly size: number;
  readonly price?: string | null;
  readonly type?: string;
  readonly side?: string;
  readonly status?: string;
  readonly datetime?: string;
  readonly idempotencyKey?: string | null;
  readonly idempotencyMetadata?: unknown;
}

interface Deferred {
  readonly promise: Promise<void>;
  resolve(): void;
}

let adminPool: Pool | undefined;
let pool: Pool | undefined;
let runner: PostgresAccountTransactionRunner;
let movements: PostgresAccountMovementRepository;
let cancelService: CancelOrderService;
let submitService: SubmitOrderService;
let nextUserId = 9701;

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
     VALUES ($1, 'B06A', 'B06A action fixture', 'ACCIONES'),
            ($2, 'B06ACASH', 'B06A cash fixture', 'MONEDA')`,
    [ACTION_ID, CASH_ID],
  );
  await pool.query(
    `INSERT INTO marketdata
       (instrumentid, date, open, high, low, close, previousclose)
     VALUES ($1, '2023-07-14', 100.00, 100.00, 100.00, 100.00, 100.00)`,
    [ACTION_ID],
  );
  await pool.query(`
    CREATE TABLE order_status_audit (
      order_id INT NOT NULL,
      previous_status TEXT,
      next_status TEXT,
      changed_at TIMESTAMP NOT NULL DEFAULT clock_timestamp()
    );

    CREATE FUNCTION audit_order_status_change() RETURNS trigger
    LANGUAGE plpgsql AS $$
    BEGIN
      INSERT INTO order_status_audit (order_id, previous_status, next_status)
      VALUES (NEW.id, OLD.status, NEW.status);
      RETURN NEW;
    END;
    $$;

    CREATE TRIGGER orders_audit_status_change
    AFTER UPDATE OF status ON orders
    FOR EACH ROW
    WHEN (OLD.status IS DISTINCT FROM NEW.status)
    EXECUTE FUNCTION audit_order_status_change();
  `);
  runner = new PostgresAccountTransactionRunner(pool);
  movements = new PostgresAccountMovementRepository(pool);
  cancelService = new CancelOrderService(runner);
  submitService = new SubmitOrderService(runner, {
    now: () => new Date(FIXED_DATE),
  });
});

afterAll(async () => {
  try {
    await pool?.end();
  } finally {
    await adminPool?.query(`DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE`);
    await adminPool?.end();
  }
});

describe('CancelOrderService against PostgreSQL', () => {
  it('cancels a BUY NEW and releases exactly size × price of reserved cash', async () => {
    const userId = await createAccount(1_000);
    const key = randomUUID();
    const created = await submitService.execute({
      userId,
      idempotencyKey: key,
      intent: limitIntent({ side: 'BUY', size: '3', limitPrice: '100' }),
    });

    const before = await resourcesFor(userId);
    expect(before.accountingCash.toString()).toBe('1000');
    expect(before.reservedBuyCash.toString()).toBe('300');
    expect(before.availableCash.toString()).toBe('700');

    const output = await cancelService.execute({
      userId,
      orderId: created.orderId,
    });

    expect(output).toEqual({ orderId: created.orderId, status: 'CANCELLED' });
    expect(await readOrder(created.orderId)).toMatchObject({
      status: 'CANCELLED',
      size: 3,
      price: '100.00',
      side: 'BUY',
      type: 'LIMIT',
    });

    const after = await resourcesFor(userId);
    expect(after.accountingCash.toString()).toBe('1000');
    expect(after.reservedBuyCash.toString()).toBe('0');
    expect(after.availableCash.toString()).toBe('1000');
    expect(after.instruments).toEqual([]);
    expect(await auditCount(created.orderId)).toBe(1);
  });

  it('cancels a SELL NEW and releases exactly its reserved shares', async () => {
    const userId = await createAccount(2_000);
    await insertOrder({
      userId,
      size: 10,
      price: '100',
      side: 'BUY',
      status: 'FILLED',
      type: 'MARKET',
    });
    const key = randomUUID();
    const created = await submitService.execute({
      userId,
      idempotencyKey: key,
      intent: limitIntent({ side: 'SELL', size: '6', limitPrice: '100' }),
    });

    const before = await resourcesFor(userId);
    expect(instrumentResources(before, ACTION_ID)).toEqual({
      instrumentId: ACTION_ID,
      executedQuantity: 10,
      sellReservedQuantity: 6,
      availableQuantity: 4,
    });
    expect(before.accountingCash.toString()).toBe('1000');

    await expect(
      cancelService.execute({ userId, orderId: created.orderId }),
    ).resolves.toEqual({
      orderId: created.orderId,
      status: 'CANCELLED',
    });

    const after = await resourcesFor(userId);
    expect(after.accountingCash.toString()).toBe('1000');
    expect(instrumentResources(after, ACTION_ID)).toEqual({
      instrumentId: ACTION_ID,
      executedQuantity: 10,
      sellReservedQuantity: 0,
      availableQuantity: 10,
    });
    expect(await auditCount(created.orderId)).toBe(1);
  });

  it('repeats a CANCELLED cancellation without writing or additional effects', async () => {
    const userId = await createAccount(1_000);
    const orderId = await insertOrder({
      userId,
      size: 2,
      price: '100',
      side: 'BUY',
      status: 'NEW',
      type: 'LIMIT',
    });
    await cancelService.execute({ userId, orderId });
    const rowBefore = await readOrder(orderId);
    const resourcesBefore = await resourcesFor(userId);

    await expect(
      cancelService.execute({ userId, orderId }),
    ).resolves.toEqual({ orderId, status: 'CANCELLED' });

    expect(await readOrder(orderId)).toEqual(rowBefore);
    expect(await resourcesFor(userId)).toEqual(resourcesBefore);
    expect(await auditCount(orderId)).toBe(1);
  });

  it('returns an internal conflict for FILLED and REJECTED without changing anything', async () => {
    const userId = await createAccount(1_000);
    const filledId = await insertOrder({
      userId,
      size: 2,
      price: '100',
      side: 'BUY',
      status: 'FILLED',
      type: 'MARKET',
    });
    const rejectedId = await insertOrder({
      userId,
      size: 5,
      price: '100',
      side: 'BUY',
      status: 'REJECTED',
      type: 'LIMIT',
    });
    const filledBefore = await readOrder(filledId);
    const rejectedBefore = await readOrder(rejectedId);
    const resourcesBefore = await resourcesFor(userId);

    await expectCancelOrderError(
      cancelService.execute({ userId, orderId: filledId }),
      'order-not-cancellable',
    );
    await expectCancelOrderError(
      cancelService.execute({ userId, orderId: rejectedId }),
      'order-not-cancellable',
    );

    expect(await readOrder(filledId)).toEqual(filledBefore);
    expect(await readOrder(rejectedId)).toEqual(rejectedBefore);
    expect(await resourcesFor(userId)).toEqual(resourcesBefore);
    expect(await auditCount(filledId)).toBe(0);
    expect(await auditCount(rejectedId)).toBe(0);
  });

  it('shares the same not-found result for a missing or foreign order', async () => {
    const ownerId = await createAccount(1_000);
    const otherId = await createAccount(1_000);
    const foreignId = await insertOrder({
      userId: ownerId,
      size: 2,
      price: '100',
      side: 'BUY',
      status: 'NEW',
      type: 'LIMIT',
    });
    const foreignBefore = await readOrder(foreignId);
    const resourcesBefore = await resourcesFor(ownerId);

    await expectCancelOrderError(
      cancelService.execute({ userId: otherId, orderId: foreignId }),
      'order-not-found',
    );
    await expectCancelOrderError(
      cancelService.execute({ userId: ownerId, orderId: 999_999 }),
      'order-not-found',
    );

    expect(await readOrder(foreignId)).toEqual(foreignBefore);
    expect(await resourcesFor(ownerId)).toEqual(resourcesBefore);
    expect(await auditCount(foreignId)).toBe(0);
  });

  it('keeps a distinguishable internal result for a missing account', async () => {
    await expectCancelOrderError(
      cancelService.execute({ userId: 999_998, orderId: 999_999 }),
      'account-not-found',
    );
  });

  it('cancels a historical NEW without identity and preserves every other field', async () => {
    const userId = await createAccount(1_000);
    const orderId = await insertOrder({
      userId,
      size: 3,
      price: '123.45',
      side: 'BUY',
      status: 'NEW',
      type: 'LIMIT',
      datetime: '2023-07-12 15:14:20',
      idempotencyKey: null,
      idempotencyMetadata: null,
    });
    const before = await readOrder(orderId);

    await expect(
      cancelService.execute({ userId, orderId }),
    ).resolves.toEqual({ orderId, status: 'CANCELLED' });

    const after = await readOrder(orderId);
    expect(after).toEqual({
      ...before,
      status: 'CANCELLED',
      xmin: after.xmin,
    });
    expect(after.idempotency_key).toBeNull();
    expect(after.idempotency_metadata).toBeNull();
    expect(await auditCount(orderId)).toBe(1);
  });

  it('rolls back without a partial cancellation and allows a later retry', async () => {
    const userId = await createAccount(1_000);
    const orderId = await insertOrder({
      userId,
      size: 2,
      price: '100',
      side: 'BUY',
      status: 'NEW',
      type: 'LIMIT',
    });
    const before = await readOrder(orderId);
    const resourcesBefore = await resourcesFor(userId);
    const failing = new CancelOrderService(
      new FailingAfterWorkRunner(runner),
    );

    await expect(
      failing.execute({ userId, orderId }),
    ).rejects.toMatchObject({ stage: 'work' });

    expect(await readOrder(orderId)).toEqual(before);
    expect(await resourcesFor(userId)).toEqual(resourcesBefore);
    expect(await auditCount(orderId)).toBe(0);

    await expect(
      cancelService.execute({ userId, orderId }),
    ).resolves.toEqual({ orderId, status: 'CANCELLED' });
    expect(await auditCount(orderId)).toBe(1);
  });

  it('performs one effective change for two concurrent cancellations', async () => {
    const userId = await createAccount(1_000);
    const orderId = await insertOrder({
      userId,
      size: 3,
      price: '100',
      side: 'BUY',
      status: 'NEW',
      type: 'LIMIT',
    });

    const [first, second] = await Promise.all([
      cancelService.execute({ userId, orderId }),
      cancelService.execute({ userId, orderId }),
    ]);

    expect(first).toEqual({ orderId, status: 'CANCELLED' });
    expect(second).toEqual({ orderId, status: 'CANCELLED' });
    expect(await auditCount(orderId)).toBe(1);
    expect((await readOrder(orderId)).status).toBe('CANCELLED');
    expect((await resourcesFor(userId)).reservedBuyCash.toString()).toBe('0');
  });

  it('serializes cancellation before a competing submission', async () => {
    const userId = await createAccount(1_000);
    const existingId = await insertOrder({
      userId,
      size: 7,
      price: '100',
      side: 'BUY',
      status: 'NEW',
      type: 'LIMIT',
    });
    const cancelGate = new GateAfterLockRunner(runner);
    const cancel = new CancelOrderService(cancelGate);
    const submitStart = new StartingRunner(runner);
    const submit = new SubmitOrderService(submitStart, {
      now: () => new Date(FIXED_DATE),
    });
    const cancelPromise = cancel.execute({ userId, orderId: existingId });
    await cancelGate.entered.promise;

    const submitPromise = submit.execute({
      userId,
      idempotencyKey: randomUUID(),
      intent: limitIntent({ side: 'BUY', size: '7', limitPrice: '100' }),
    });
    await submitStart.started.promise;
    cancelGate.open();

    const [cancelled, submitted] = await Promise.all([
      cancelPromise,
      submitPromise,
    ]);

    expect(cancelled).toEqual({ orderId: existingId, status: 'CANCELLED' });
    expect(submitted.status).toBe('NEW');
    expect((await resourcesFor(userId)).reservedBuyCash.toString()).toBe('700');
    expect(await auditCount(existingId)).toBe(1);
  });

  it('serializes a competing submission before cancellation', async () => {
    const userId = await createAccount(1_000);
    const existingId = await insertOrder({
      userId,
      size: 7,
      price: '100',
      side: 'BUY',
      status: 'NEW',
      type: 'LIMIT',
    });
    const submitGate = new GateAfterLockRunner(runner);
    const submit = new SubmitOrderService(submitGate, {
      now: () => new Date(FIXED_DATE),
    });
    const cancelStart = new StartingRunner(runner);
    const cancel = new CancelOrderService(cancelStart);
    const submitPromise = submit.execute({
      userId,
      idempotencyKey: randomUUID(),
      intent: limitIntent({ side: 'BUY', size: '7', limitPrice: '100' }),
    });
    await submitGate.entered.promise;

    const cancelPromise = cancel.execute({ userId, orderId: existingId });
    await cancelStart.started.promise;
    submitGate.open();

    const [submitted, cancelled] = await Promise.all([
      submitPromise,
      cancelPromise,
    ]);

    expect(submitted.status).toBe('REJECTED');
    expect(cancelled).toEqual({ orderId: existingId, status: 'CANCELLED' });
    expect((await resourcesFor(userId)).reservedBuyCash.toString()).toBe('0');
    expect(await auditCount(existingId)).toBe(1);
  });

  it('replays the original creation UUID as CANCELLED without reopening or reserving', async () => {
    const userId = await createAccount(1_000);
    const key = randomUUID();
    const intent = limitIntent({
      side: 'BUY',
      size: '2',
      limitPrice: '100',
    });
    const created = await submitService.execute({
      userId,
      idempotencyKey: key,
      intent,
    });
    await cancelService.execute({ userId, orderId: created.orderId });
    const rowBefore = await readOrder(created.orderId);
    const resourcesBefore = await resourcesFor(userId);

    const replay = await submitService.execute({
      userId,
      idempotencyKey: key,
      intent,
    });

    expect(replay).toEqual({
      orderId: created.orderId,
      status: 'CANCELLED',
      replayed: true,
    });
    expect(await readOrder(created.orderId)).toEqual(rowBefore);
    expect(await resourcesFor(userId)).toEqual(resourcesBefore);
    expect(await countByKey(userId, key)).toBe(1);
  });

  it('does not return success or deny the change when COMMIT is uncertain', async () => {
    const userId = await createAccount(1_000);
    const orderId = await insertOrder({
      userId,
      size: 2,
      price: '100',
      side: 'BUY',
      status: 'NEW',
      type: 'LIMIT',
    });
    const uncertainRunner = new PostgresAccountTransactionRunner(
      new LostCommitResponsePool(pool!),
    );
    const service = new CancelOrderService(uncertainRunner);

    let caught: unknown;

    try {
      await service.execute({ userId, orderId });
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(AccountTransactionError);
    expect(caught).toMatchObject({
      stage: 'commit',
      commitOutcome: 'uncertain',
    });
    expect(caught).not.toBeInstanceOf(CancelOrderError);
    expect(String((caught as Error).message)).not.toMatch(/rollback/i);
    expect((await readOrder(orderId)).status).toBe('CANCELLED');
    expect(await auditCount(orderId)).toBe(1);
  });
});

class FailingAfterWorkRunner implements AccountTransactionRunner {
  constructor(private readonly inner: AccountTransactionRunner) {}

  run<T>(
    userId: number,
    work: (context: AccountTransactionContext) => Promise<T>,
  ): Promise<AccountTransactionResult<T>> {
    return this.inner.run(userId, async (context) => {
      await work(context);
      throw new Error('forced failure after the cancellation update');
    });
  }
}

class GateAfterLockRunner implements AccountTransactionRunner {
  private readonly opened = deferred();
  readonly entered = deferred();

  constructor(private readonly inner: AccountTransactionRunner) {}

  run<T>(
    userId: number,
    work: (context: AccountTransactionContext) => Promise<T>,
  ): Promise<AccountTransactionResult<T>> {
    return this.inner.run(userId, async (context) => {
      this.entered.resolve();
      await this.opened.promise;

      return work(context);
    });
  }

  open(): void {
    this.opened.resolve();
  }
}

class StartingRunner implements AccountTransactionRunner {
  readonly started = deferred();

  constructor(private readonly inner: AccountTransactionRunner) {}

  run<T>(
    userId: number,
    work: (context: AccountTransactionContext) => Promise<T>,
  ): Promise<AccountTransactionResult<T>> {
    this.started.resolve();

    return this.inner.run(userId, work);
  }
}

class LostCommitResponsePool implements PostgresConnectionPool {
  constructor(private readonly pool: Pool) {}

  async connect(): Promise<PostgresTransactionClient> {
    const client = await this.pool.connect();

    return {
      async query<Row extends QueryResultRow>(
        text: string,
        values: unknown[],
      ): Promise<QueryResult<Row>> {
        const result = await client.query<Row>(text, values);

        if (text === 'COMMIT') {
          throw new Error('connection lost after sending COMMIT');
        }

        return result;
      },
      release(destroy?: boolean): void {
        client.release(destroy);
      },
    };
  }
}

function deferred(): Deferred {
  let resolve: () => void = () => undefined;
  const promise = new Promise<void>((resolver) => {
    resolve = resolver;
  });

  return { promise, resolve };
}

function limitIntent(
  overrides: {
    readonly side?: 'BUY' | 'SELL';
    readonly size?: string;
    readonly limitPrice?: string;
  } = {},
): OrderIntent {
  return createOrderIntent({
    instrumentId: ACTION_ID,
    side: overrides.side ?? 'BUY',
    type: 'LIMIT',
    size: overrides.size ?? '1',
    limitPrice: overrides.limitPrice ?? '100',
  });
}

async function createAccount(cash: number): Promise<number> {
  const userId = nextUserId;
  nextUserId += 1;
  await pool!.query(
    'INSERT INTO users (id, email, accountnumber) VALUES ($1, $2, $3)',
    [userId, `b06a-${userId}@example.invalid`, `B06A${userId}`],
  );
  await insertOrder({
    userId,
    size: cash,
    price: null,
    side: 'CASH_IN',
    status: 'FILLED',
    type: 'MARKET',
    datetime: '2023-07-01 00:00:00',
    instrumentId: CASH_ID,
  });

  return userId;
}

async function insertOrder(
  options: InsertOrderOptions & { readonly instrumentId?: number },
): Promise<number> {
  const hasIdentity =
    options.idempotencyKey !== undefined &&
    options.idempotencyKey !== null &&
    options.idempotencyMetadata !== undefined &&
    options.idempotencyMetadata !== null;
  const result = await pool!.query<{ id: number }>(
    hasIdentity
      ? `INSERT INTO orders
           (instrumentid, userid, size, price, side, status, type, datetime,
            idempotency_key, idempotency_metadata)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
         RETURNING id`
      : `INSERT INTO orders
           (instrumentid, userid, size, price, side, status, type, datetime)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
         RETURNING id`,
    hasIdentity
      ? [
          options.instrumentId ?? ACTION_ID,
          options.userId,
          options.size,
          options.price ?? null,
          options.side ?? 'BUY',
          options.status ?? 'NEW',
          options.type ?? 'LIMIT',
          options.datetime ?? '2023-07-01 00:00:00',
          options.idempotencyKey,
          JSON.stringify(options.idempotencyMetadata),
        ]
      : [
          options.instrumentId ?? ACTION_ID,
          options.userId,
          options.size,
          options.price ?? null,
          options.side ?? 'BUY',
          options.status ?? 'NEW',
          options.type ?? 'LIMIT',
          options.datetime ?? '2023-07-01 00:00:00',
        ],
  );
  const id = result.rows[0]?.id;

  if (id === undefined) {
    throw new Error('The order fixture was not inserted.');
  }

  return id;
}

async function readOrder(orderId: number): Promise<OrderRow> {
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
            idempotency_metadata,
            xmin::text AS xmin
       FROM orders
      WHERE id = $1`,
    [orderId],
  );
  const row = result.rows[0];

  if (row === undefined) {
    throw new Error('The order was not found.');
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

async function auditCount(orderId: number): Promise<number> {
  const result = await pool!.query<{ count: number }>(
    `SELECT count(*)::int AS count
       FROM order_status_audit
      WHERE order_id = $1`,
    [orderId],
  );

  return result.rows[0]?.count ?? 0;
}

async function resourcesFor(userId: number): Promise<AccountResources> {
  return calculateAccountResources(await movements.findByUserId(userId));
}

function instrumentResources(
  resources: AccountResources,
  instrumentId: number,
): AccountResources['instruments'][number] {
  const found = resources.instruments.find(
    (instrument) => instrument.instrumentId === instrumentId,
  );

  if (found === undefined) {
    throw new Error('The fixture instrument has no resources.');
  }

  return found;
}

async function expectCancelOrderError(
  action: Promise<unknown>,
  code: string,
): Promise<void> {
  try {
    await action;
  } catch (error) {
    expect(error).toBeInstanceOf(CancelOrderError);
    expect(error).toMatchObject({ code });

    return;
  }

  throw new Error(`Expected CancelOrderError code ${code}.`);
}
