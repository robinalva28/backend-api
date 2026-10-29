import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { Pool } from 'pg';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { SubmitOrderError } from '../../src/orders/application/errors/submit-order.error.js';
import { SubmitOrderService } from '../../src/orders/application/submit-order.service.js';
import type { SubmitOrderInput } from '../../src/orders/application/ports/in/submit-order.use-case.js';
import { buildOrderIntentMetadata } from '../../src/orders/domain/order-intent-metadata.js';
import {
  createOrderIntent,
  type OrderIntent,
  type OrderIntentInput,
} from '../../src/orders/domain/order-intent.js';
import { OrderIntentError } from '../../src/orders/domain/order-intent.error.js';
import type { AccountResources } from '../../src/resources/domain/account-resources.js';
import { calculateAccountResources } from '../../src/resources/domain/calculate-account-resources.js';
import { PostgresAccountMovementRepository } from '../../src/resources/infrastructure/persistence/postgres-account-movement.repository.js';
import { AccountTransactionError } from '../../src/transactions/application/errors/account-transaction.error.js';
import type {
  AccountTransactionContext,
  AccountTransactionResult,
  AccountTransactionRunner,
} from '../../src/transactions/application/ports/out/account-transaction.port.js';
import { PostgresAccountTransactionRunner } from '../../src/transactions/infrastructure/persistence/postgres-account-transaction.runner.js';
import { testDatabaseConfig } from '../support/test-database.js';

const SCHEMA = 'b05a_test';
const ACTION_ID = 9201;
const NO_QUOTE_ID = 9202;
const CASH_ID = 9203;
const OTHER_TYPE_ID = 9204;
const BAD_LATEST_ID = 9205;
const FIXED_DATE = new Date('2026-10-28T18:30:45.123Z');
const FIXED_DATETIME = '2026-10-28 18:30:45.123';

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

let adminPool: Pool | undefined;
let pool: Pool | undefined;
let runner: PostgresAccountTransactionRunner;
let movements: PostgresAccountMovementRepository;
let service: SubmitOrderService;
let nextUserId = 9301;

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
     VALUES ($1, 'B05A', 'B05A action fixture', 'ACCIONES'),
            ($2, 'B05ANQ', 'B05A no-quote fixture', 'ACCIONES'),
            ($3, 'B05ACASH', 'B05A cash fixture', 'MONEDA'),
            ($4, 'B05ABOND', 'B05A other-type fixture', 'BONO'),
            ($5, 'B05ABAD', 'B05A invalid-quote fixture', 'ACCIONES')`,
    [ACTION_ID, NO_QUOTE_ID, CASH_ID, OTHER_TYPE_ID, BAD_LATEST_ID],
  );
  await pool.query(
    `INSERT INTO marketdata
       (instrumentid, date, open, high, low, close, previousclose)
     VALUES
       ($1, '2023-07-13', 100.00, 100.00, 100.00, 100.00, 90.00),
       ($1, '2023-07-14', 300.00, 300.00, 300.00, 300.00, 100.00),
       ($2, '2023-07-13', 50.00, 50.00, 50.00, 50.00, 50.00),
       ($2, '2023-07-14', 0.00, 0.00, 0.00, 0.00, 0.00)`,
    [ACTION_ID, BAD_LATEST_ID],
  );
  runner = new PostgresAccountTransactionRunner(pool);
  movements = new PostgresAccountMovementRepository(pool);
  service = new SubmitOrderService(runner, {
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

afterEach(async () => {
  if (pool === undefined) {
    return;
  }

  await pool.query(
    `DELETE FROM marketdata
      WHERE instrumentid = $1
        AND date > '2023-07-14'`,
    [ACTION_ID],
  );
  await pool.query('DELETE FROM marketdata WHERE instrumentid = $1', [
    NO_QUOTE_ID,
  ]);
});

describe('SubmitOrderService against PostgreSQL', () => {
  it('submits a BUY MARKET as FILLED with UTC date, metadata and B02 effects', async () => {
    const userId = await createAccount(10_000);
    const key = randomUUID();
    const intent = marketIntent({ side: 'BUY', size: '10' });

    const output = await service.execute({ userId, idempotencyKey: key, intent });
    const row = await readOrderByKey(userId, key);

    expect(output).toEqual({
      orderId: row.id,
      status: 'FILLED',
      replayed: false,
    });
    expect(row).toEqual({
      id: row.id,
      instrumentid: ACTION_ID,
      userid: userId,
      size: 10,
      price: '300.00',
      type: 'MARKET',
      side: 'BUY',
      status: 'FILLED',
      datetime: FIXED_DATETIME,
      idempotency_key: key,
      idempotency_metadata: buildOrderIntentMetadata(intent),
    });
    expect(row.idempotency_metadata).not.toHaveProperty('currency');

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
  });

  it('submits SELL MARKET and rejects a SELL without available shares after NEW reserves', async () => {
    const userId = await createAccount(1_000);
    await insertBuyFilled(userId, ACTION_ID, 10, '100');
    await insertSellNew(userId, ACTION_ID, 6, '100');
    const key = randomUUID();
    const intent = marketIntent({ side: 'SELL', size: '4' });

    const output = await service.execute({ userId, idempotencyKey: key, intent });
    const row = await readOrderByKey(userId, key);

    expect(output.status).toBe('FILLED');
    expect(row).toMatchObject({
      instrumentid: ACTION_ID,
      size: 4,
      price: '300.00',
      side: 'SELL',
      status: 'FILLED',
    });

    const afterSell = await resourcesFor(userId);
    expect(afterSell.accountingCash.toString()).toBe('1200');
    expect(instrumentResources(afterSell, ACTION_ID)).toEqual({
      instrumentId: ACTION_ID,
      executedQuantity: 6,
      sellReservedQuantity: 6,
      availableQuantity: 0,
    });

    const rejectedKey = randomUUID();
    const rejected = await service.execute({
      userId,
      idempotencyKey: rejectedKey,
      intent: marketIntent({ side: 'SELL', size: '1' }),
    });

    expect(rejected.status).toBe('REJECTED');
    expect(await readOrderByKey(userId, rejectedKey)).toMatchObject({
      size: 1,
      status: 'REJECTED',
    });
    expect(await resourcesFor(userId)).toEqual(afterSell);
  });

  it('submits SELL LIMIT as NEW and reserves shares without execution', async () => {
    const userId = await createAccount(2_000);
    await insertBuyFilled(userId, ACTION_ID, 10, '100');
    const key = randomUUID();
    const intent = limitIntent({
      side: 'SELL',
      size: '4',
      limitPrice: '100',
    });

    const output = await service.execute({ userId, idempotencyKey: key, intent });

    expect(output.status).toBe('NEW');
    expect(await readOrderByKey(userId, key)).toMatchObject({
      size: 4,
      price: '100.00',
      type: 'LIMIT',
      side: 'SELL',
      status: 'NEW',
    });

    const resources = await resourcesFor(userId);
    expect(resources.accountingCash.toString()).toBe('1000');
    expect(resources.reservedBuyCash.toString()).toBe('0');
    expect(instrumentResources(resources, ACTION_ID)).toEqual({
      instrumentId: ACTION_ID,
      executedQuantity: 10,
      sellReservedQuantity: 4,
      availableQuantity: 6,
    });
  });

  it('converts a SELL amount with the exact market-price floor', async () => {
    const userId = await createAccount(2_000);
    await insertBuyFilled(userId, ACTION_ID, 10, '100');
    const key = randomUUID();
    const intent = amountIntent({ side: 'SELL', amount: '600' });

    const output = await service.execute({ userId, idempotencyKey: key, intent });

    expect(output.status).toBe('FILLED');
    expect(await readOrderByKey(userId, key)).toMatchObject({
      size: 2,
      price: '300.00',
      side: 'SELL',
      status: 'FILLED',
      idempotency_metadata: buildOrderIntentMetadata(intent),
    });

    const resources = await resourcesFor(userId);
    expect(resources.accountingCash.toString()).toBe('1600');
    expect(instrumentResources(resources, ACTION_ID)).toEqual({
      instrumentId: ACTION_ID,
      executedQuantity: 8,
      sellReservedQuantity: 0,
      availableQuantity: 8,
    });
  });

  it('rejects a missing account without creating an order', async () => {
    const key = randomUUID();

    await expectSubmitOrderError(
      service.execute({
        userId: 999_999,
        idempotencyKey: key,
        intent: marketIntent({ size: '1' }),
      }),
      'account-not-found',
    );
    expect(await countByKey(999_999, key)).toBe(0);
  });

  it('creates a LIMIT without a quote and reserves cash without execution', async () => {
    const userId = await createAccount(1_000);
    const key = randomUUID();
    const intent = limitIntent({
      instrumentId: NO_QUOTE_ID,
      size: '2',
      limitPrice: '100',
    });

    const output = await service.execute({ userId, idempotencyKey: key, intent });

    expect(output.status).toBe('NEW');
    expect(await readOrderByKey(userId, key)).toMatchObject({
      instrumentid: NO_QUOTE_ID,
      size: 2,
      price: '100.00',
      type: 'LIMIT',
      side: 'BUY',
      status: 'NEW',
    });

    const resources = await resourcesFor(userId);
    expect(resources.accountingCash.toString()).toBe('1000');
    expect(resources.reservedBuyCash.toString()).toBe('200');
    expect(resources.availableCash.toString()).toBe('800');
    expect(resources.instruments).toEqual([]);
  });

  it('converts amounts with the exact floor and keeps the original amount', async () => {
    const marketUser = await createAccount(10_000);
    const marketKey = randomUUID();
    const marketAmount = amountIntent({ amount: '1000' });

    const market = await service.execute({
      userId: marketUser,
      idempotencyKey: marketKey,
      intent: marketAmount,
    });
    const marketRow = await readOrderByKey(marketUser, marketKey);

    expect(market.status).toBe('FILLED');
    expect(marketRow).toMatchObject({
      size: 3,
      price: '300.00',
      status: 'FILLED',
      idempotency_metadata: buildOrderIntentMetadata(marketAmount),
    });
    expect((await resourcesFor(marketUser)).accountingCash.toString()).toBe(
      '9100',
    );

    const limitUser = await createAccount(1_000);
    const limitKey = randomUUID();
    const limitAmount = limitIntent({
      amount: '9.99',
      limitPrice: '0.03',
      size: null,
    });

    const limit = await service.execute({
      userId: limitUser,
      idempotencyKey: limitKey,
      intent: limitAmount,
    });
    const limitRow = await readOrderByKey(limitUser, limitKey);

    expect(limit.status).toBe('NEW');
    expect(limitRow).toMatchObject({
      size: 333,
      price: '0.03',
      status: 'NEW',
      idempotency_metadata: buildOrderIntentMetadata(limitAmount),
    });
    expect((await resourcesFor(limitUser)).reservedBuyCash.toString()).toBe(
      '9.99',
    );

    const zeroUser = await createAccount(1_000);
    const zeroKey = randomUUID();

    await expectSubmitOrderError(
      service.execute({
        userId: zeroUser,
        idempotencyKey: zeroKey,
        intent: limitIntent({
          amount: '0.02',
          limitPrice: '0.03',
          size: null,
        }),
      }),
      'quantity-not-representable',
    );
    expect(await countByKey(zeroUser, zeroKey)).toBe(0);
  });

  it('persists an insufficient BUY as REJECTED without execution or reservation', async () => {
    const userId = await createAccount(100);
    const key = randomUUID();
    const intent = marketIntent({ side: 'BUY', size: '1' });

    const output = await service.execute({ userId, idempotencyKey: key, intent });
    const row = await readOrderByKey(userId, key);

    expect(output.status).toBe('REJECTED');
    expect(row).toMatchObject({
      size: 1,
      price: '300.00',
      status: 'REJECTED',
    });

    const resources = await resourcesFor(userId);
    expect(resources.accountingCash.toString()).toBe('100');
    expect(resources.reservedBuyCash.toString()).toBe('0');
    expect(resources.availableCash.toString()).toBe('100');
    expect(resources.instruments).toEqual([]);
  });

  it('does not consume the UUID when a new MARKET has no quote', async () => {
    const userId = await createAccount(1_000);
    const key = randomUUID();
    const intent = marketIntent({ instrumentId: NO_QUOTE_ID, size: '1' });

    await expectSubmitOrderError(
      service.execute({ userId, idempotencyKey: key, intent }),
      'quote-unavailable',
    );
    expect(await countByKey(userId, key)).toBe(0);

    await insertQuote(NO_QUOTE_ID, '2023-07-14', '100.00');

    const output = await service.execute({ userId, idempotencyKey: key, intent });

    expect(output.status).toBe('FILLED');
    expect(await countByKey(userId, key)).toBe(1);
    expect(await readOrderByKey(userId, key)).toMatchObject({
      size: 1,
      price: '100.00',
      status: 'FILLED',
    });
  });

  it('does not fall back to an older quote when the latest close is invalid', async () => {
    const userId = await createAccount(1_000);
    const key = randomUUID();

    await expectSubmitOrderError(
      service.execute({
        userId,
        idempotencyKey: key,
        intent: marketIntent({ instrumentId: BAD_LATEST_ID, size: '1' }),
      }),
      'quote-invalid',
    );
    expect(await countByKey(userId, key)).toBe(0);
  });

  it('rejects missing and non-ACCIONES instruments without an order', async () => {
    const userId = await createAccount(1_000);
    const missingKey = randomUUID();
    const cashKey = randomUUID();
    const otherTypeKey = randomUUID();

    await expectSubmitOrderError(
      service.execute({
        userId,
        idempotencyKey: missingKey,
        intent: marketIntent({ instrumentId: 9999, size: '1' }),
      }),
      'instrument-not-found',
    );
    await expectSubmitOrderError(
      service.execute({
        userId,
        idempotencyKey: cashKey,
        intent: marketIntent({ instrumentId: CASH_ID, size: '1' }),
      }),
      'instrument-not-tradable',
    );
    await expectSubmitOrderError(
      service.execute({
        userId,
        idempotencyKey: otherTypeKey,
        intent: marketIntent({ instrumentId: OTHER_TYPE_ID, size: '1' }),
      }),
      'instrument-not-tradable',
    );
    expect(await countByKey(userId, missingKey)).toBe(0);
    expect(await countByKey(userId, cashKey)).toBe(0);
    expect(await countByKey(userId, otherTypeKey)).toBe(0);
  });

  it('rejects a currency other than ARS without an order', async () => {
    const userId = await createAccount(1_000);
    const key = randomUUID();

    await expectSubmitOrderError(
      service.execute({
        userId,
        idempotencyKey: key,
        intent: marketIntent({ size: '1' }),
        currency: 'USD',
      }),
      'unsupported-currency',
    );
    expect(await countByKey(userId, key)).toBe(0);
  });

  it('replays a CANCELLED order without reopening or reserving again', async () => {
    const userId = await createAccount(1_000);
    const key = randomUUID();
    const intent = limitIntent({ size: '2', limitPrice: '100' });
    const created = await service.execute({ userId, idempotencyKey: key, intent });

    await updateStatus(created.orderId, 'CANCELLED');
    await insertQuote(ACTION_ID, '2024-01-01', '999.00');
    await insertCashIn(userId, 5_000);
    const beforeReplay = await resourcesFor(userId);
    const rowBeforeReplay = await readOrder(created.orderId);

    const replay = await service.execute({
      userId,
      idempotencyKey: key,
      intent,
      currency: 'ARS',
    });

    expect(replay).toEqual({
      orderId: created.orderId,
      status: 'CANCELLED',
      replayed: true,
    });
    expect(await readOrder(created.orderId)).toEqual(rowBeforeReplay);
    expect(await resourcesFor(userId)).toEqual(beforeReplay);
    expect(await countByKey(userId, key)).toBe(1);
  });

  it('replays a REJECTED order after resources change without re-evaluating it', async () => {
    const userId = await createAccount(100);
    const key = randomUUID();
    const intent = marketIntent({ side: 'BUY', size: '1' });
    const created = await service.execute({ userId, idempotencyKey: key, intent });

    expect(created.status).toBe('REJECTED');
    await insertCashIn(userId, 10_000);
    const beforeReplay = await resourcesFor(userId);
    const rowBeforeReplay = await readOrder(created.orderId);

    const replay = await service.execute({ userId, idempotencyKey: key, intent });

    expect(replay).toEqual({
      orderId: created.orderId,
      status: 'REJECTED',
      replayed: true,
    });
    expect(await readOrder(created.orderId)).toEqual(rowBeforeReplay);
    expect(await resourcesFor(userId)).toEqual(beforeReplay);
    expect(await countByKey(userId, key)).toBe(1);
  });

  it('replays a FILLED order after the quote changes without another effect', async () => {
    const userId = await createAccount(10_000);
    const key = randomUUID();
    const intent = marketIntent({ side: 'BUY', size: '1' });
    const created = await service.execute({ userId, idempotencyKey: key, intent });

    await insertQuote(ACTION_ID, '2024-02-01', '999.00');
    await insertCashIn(userId, 5_000);
    const beforeReplay = await resourcesFor(userId);
    const rowBeforeReplay = await readOrder(created.orderId);

    const replay = await service.execute({ userId, idempotencyKey: key, intent });

    expect(replay).toEqual({
      orderId: created.orderId,
      status: 'FILLED',
      replayed: true,
    });
    expect(await readOrder(created.orderId)).toEqual(rowBeforeReplay);
    expect(await resourcesFor(userId)).toEqual(beforeReplay);
    expect(await countByKey(userId, key)).toBe(1);
  });

  it('treats omitted currency and explicit ARS as equivalent for idempotency', async () => {
    const userId = await createAccount(10_000);
    const key = randomUUID();
    const intent = marketIntent({ size: '1' });

    const created = await service.execute({ userId, idempotencyKey: key, intent });
    const replay = await service.execute({
      userId,
      idempotencyKey: key,
      intent,
      currency: 'ARS',
    });

    expect(created.replayed).toBe(false);
    expect(replay).toEqual({
      orderId: created.orderId,
      status: created.status,
      replayed: true,
    });
    expect(await countByKey(userId, key)).toBe(1);
  });

  it('returns a conflict without overwriting the original order', async () => {
    const userId = await createAccount(10_000);
    const key = randomUUID();
    const intent = limitIntent({ size: '2', limitPrice: '100' });
    const created = await service.execute({ userId, idempotencyKey: key, intent });
    const rowBefore = await readOrder(created.orderId);
    const resourcesBefore = await resourcesFor(userId);

    await expectSubmitOrderError(
      service.execute({
        userId,
        idempotencyKey: key,
        intent: limitIntent({ size: '3', limitPrice: '100' }),
      }),
      'conflict',
    );

    expect(await readOrder(created.orderId)).toEqual(rowBefore);
    expect(await resourcesFor(userId)).toEqual(resourcesBefore);
    expect(await countByKey(userId, key)).toBe(1);
  });

  it('fails internally on invalid persisted metadata without creating another order', async () => {
    const userId = await createAccount(1_000);
    const key = randomUUID();
    const inserted = await insertOrderWithMetadata(userId, key, {
      version: 1,
      parameters: {},
    });

    await expect(
      service.execute({
        userId,
        idempotencyKey: key,
        intent: limitIntent({ size: '1', limitPrice: '100' }),
      }),
    ).rejects.toMatchObject({
      stage: 'work',
      commitOutcome: 'not-attempted',
      cause: expect.any(OrderIntentError),
    });

    expect(await countByKey(userId, key)).toBe(1);
    expect(await readOrder(inserted)).toMatchObject({
      idempotency_key: key,
      status: 'NEW',
    });
  });

  it('creates only one order for concurrent submissions with the same key', async () => {
    const userId = await createAccount(10_000);
    const key = randomUUID();
    const intent = marketIntent({ side: 'BUY', size: '1' });

    const [first, second] = await Promise.all([
      service.execute({ userId, idempotencyKey: key, intent }),
      service.execute({ userId, idempotencyKey: key, intent }),
    ]);

    expect(first.orderId).toBe(second.orderId);
    expect([first.replayed, second.replayed].sort()).toEqual([false, true]);
    expect(await countByKey(userId, key)).toBe(1);
    expect((await resourcesFor(userId)).accountingCash.toString()).toBe('9700');
  });

  it('serializes different keys competing for the same available cash', async () => {
    const userId = await createAccount(1_000);
    const firstKey = randomUUID();
    const secondKey = randomUUID();
    const intent = limitIntent({ size: '7', limitPrice: '100' });

    const [first, second] = await Promise.all([
      service.execute({ userId, idempotencyKey: firstKey, intent }),
      service.execute({ userId, idempotencyKey: secondKey, intent }),
    ]);

    expect([first.status, second.status].sort()).toEqual(['NEW', 'REJECTED']);
    expect(await countByKey(userId, firstKey)).toBe(1);
    expect(await countByKey(userId, secondKey)).toBe(1);

    const resources = await resourcesFor(userId);
    expect(resources.accountingCash.toString()).toBe('1000');
    expect(resources.reservedBuyCash.toString()).toBe('700');
    expect(resources.availableCash.toString()).toBe('300');
    expect(resources.instruments).toEqual([]);
  });

  it('rolls back the inserted row and allows the same key to be retried', async () => {
    const userId = await createAccount(10_000);
    const key = randomUUID();
    const intent = marketIntent({ size: '1' });
    const failingService = new SubmitOrderService(
      new FailingAfterWorkRunner(runner),
      { now: () => new Date(FIXED_DATE) },
    );

    await expect(
      failingService.execute({ userId, idempotencyKey: key, intent }),
    ).rejects.toMatchObject({ stage: 'work' });
    expect(await countByKey(userId, key)).toBe(0);

    const retry = await service.execute({ userId, idempotencyKey: key, intent });

    expect(retry.status).toBe('FILLED');
    expect(await countByKey(userId, key)).toBe(1);
    expect((await resourcesFor(userId)).accountingCash.toString()).toBe('9700');
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
      throw new Error('forced failure after the order insert');
    });
  }
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

function amountIntent(overrides: Partial<OrderIntentInput> = {}): OrderIntent {
  return createOrderIntent({
    instrumentId: ACTION_ID,
    side: 'BUY',
    type: 'MARKET',
    amount: '1000',
    ...overrides,
  });
}

async function createAccount(cash: number): Promise<number> {
  const userId = nextUserId;
  nextUserId += 1;
  await pool!.query('INSERT INTO users (id) VALUES ($1)', [userId]);
  await insertCashIn(userId, cash);

  return userId;
}

async function insertCashIn(userId: number, size: number): Promise<void> {
  await pool!.query(
    `INSERT INTO orders
       (instrumentid, userid, size, price, side, status, type, datetime)
     VALUES ($1, $2, $3, NULL, 'CASH_IN', 'FILLED', 'MARKET', $4)`,
    [CASH_ID, userId, size, '2023-07-01 00:00:00'],
  );
}

async function insertBuyFilled(
  userId: number,
  instrumentId: number,
  size: number,
  price: string,
): Promise<void> {
  await pool!.query(
    `INSERT INTO orders
       (instrumentid, userid, size, price, side, status, type, datetime)
     VALUES ($1, $2, $3, $4, 'BUY', 'FILLED', 'MARKET', $5)`,
    [instrumentId, userId, size, price, '2023-07-01 00:00:00'],
  );
}

async function insertSellNew(
  userId: number,
  instrumentId: number,
  size: number,
  price: string,
): Promise<void> {
  await pool!.query(
    `INSERT INTO orders
       (instrumentid, userid, size, price, side, status, type, datetime)
     VALUES ($1, $2, $3, $4, 'SELL', 'NEW', 'LIMIT', $5)`,
    [instrumentId, userId, size, price, '2023-07-01 00:00:00'],
  );
}

async function insertQuote(
  instrumentId: number,
  date: string,
  close: string,
): Promise<void> {
  await pool!.query(
    `INSERT INTO marketdata
       (instrumentid, date, open, high, low, close, previousclose)
     VALUES ($1, $2, $3, $3, $3, $3, $3)`,
    [instrumentId, date, close],
  );
}

async function insertOrderWithMetadata(
  userId: number,
  key: string,
  metadata: unknown,
): Promise<number> {
  const result = await pool!.query<{ id: number }>(
    `INSERT INTO orders
       (instrumentid, userid, size, price, side, status, type, datetime,
        idempotency_key, idempotency_metadata)
     VALUES ($1, $2, 1, '100.00', 'BUY', 'NEW', 'LIMIT', $3, $4, $5)
     RETURNING id`,
    [
      ACTION_ID,
      userId,
      '2023-07-01 00:00:00',
      key,
      JSON.stringify(metadata),
    ],
  );
  const id = result.rows[0]?.id;

  if (id === undefined) {
    throw new Error('The invalid-metadata fixture was not inserted.');
  }

  return id;
}

async function updateStatus(orderId: number, status: string): Promise<void> {
  await pool!.query('UPDATE orders SET status = $1 WHERE id = $2', [
    status,
    orderId,
  ]);
}

async function readOrderByKey(
  userId: number,
  key: string,
): Promise<OrderRow> {
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
      WHERE userid = $1
        AND idempotency_key = $2::uuid`,
    [userId, key],
  );
  const row = result.rows[0];

  if (row === undefined) {
    throw new Error('The submitted order was not found.');
  }

  return row;
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

async function expectSubmitOrderError(
  action: Promise<unknown>,
  code: string,
): Promise<void> {
  try {
    await action;
  } catch (error) {
    expect(error).toBeInstanceOf(SubmitOrderError);
    expect(error).toMatchObject({ code });

    return;
  }

  throw new Error(`Expected SubmitOrderError code ${code}.`);
}
