import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { Pool } from 'pg';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { configureHttpApplication } from '../../src/bootstrap/configure-http.js';
import { AppModule } from '../../src/app.module.js';
import { PG_POOL } from '../../src/database/database.tokens.js';
import {
  INVALID_CANCEL_REQUEST_MESSAGE,
  ORDER_NOT_CANCELLABLE_MESSAGE,
  ORDER_NOT_FOUND_MESSAGE,
} from '../../src/orders/infrastructure/http/http-messages.js';
import type { AccountResources } from '../../src/resources/domain/account-resources.js';
import { calculateAccountResources } from '../../src/resources/domain/calculate-account-resources.js';
import { PostgresAccountMovementRepository } from '../../src/resources/infrastructure/persistence/postgres-account-movement.repository.js';
import { testDatabaseConfig } from '../support/test-database.js';

const SCHEMA = 'b06b_test';
const ACTION_ID = 9801;
const CASH_ID = 9802;
const FIXED_DATETIME = '2023-07-01 00:00:00';

const INVALID = { message: INVALID_CANCEL_REQUEST_MESSAGE };
const NOT_FOUND = { message: ORDER_NOT_FOUND_MESSAGE };
const NOT_CANCELLABLE = { message: ORDER_NOT_CANCELLABLE_MESSAGE };

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
  readonly instrumentId?: number;
  readonly price?: string | null;
  readonly type?: string;
  readonly side?: string;
  readonly status?: string;
  readonly datetime?: string;
  readonly idempotencyKey?: string;
  readonly idempotencyMetadata?: unknown;
}

let adminPool: Pool | undefined;
let pool: Pool | undefined;
let app: INestApplication | undefined;
let movements: PostgresAccountMovementRepository;
let nextUserId = 9901;

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
     VALUES ($1, 'B06B', 'B06B action fixture', 'ACCIONES'),
            ($2, 'B06BCASH', 'B06B cash fixture', 'MONEDA')`,
    [ACTION_ID, CASH_ID],
  );

  const moduleFixture = await Test.createTestingModule({
    imports: [AppModule],
  })
    .overrideProvider(PG_POOL)
    .useValue(pool)
    .compile();

  app = moduleFixture.createNestApplication();
  configureHttpApplication(app);
  await app.init();
  movements = new PostgresAccountMovementRepository(pool);
});

afterAll(async () => {
  try {
    await app?.close();
  } finally {
    await adminPool?.query(`DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE`);
    await adminPool?.end();
  }
});

function httpServer(): Parameters<typeof request>[0] {
  return app!.getHttpServer() as Parameters<typeof request>[0];
}

describe('POST cancellation against PostgreSQL', () => {
  it('cancels a BUY NEW, releases its reserve and preserves all other fields', async () => {
    const userId = await createAccount(1_000);
    const key = randomUUID();
    const metadata = {
      version: 1,
      parameters: {
        instrumentId: ACTION_ID,
        side: 'BUY',
        type: 'LIMIT',
        mode: 'size',
        size: '3',
        limitPrice: '100',
      },
    };
    const orderId = await insertOrder({
      userId,
      size: 3,
      price: '100',
      side: 'BUY',
      status: 'NEW',
      type: 'LIMIT',
      idempotencyKey: key,
      idempotencyMetadata: metadata,
    });
    const before = await readOrder(orderId);
    const resourcesBefore = await resourcesFor(userId);

    expect(resourcesBefore.accountingCash.toString()).toBe('1000');
    expect(resourcesBefore.reservedBuyCash.toString()).toBe('300');
    expect(resourcesBefore.availableCash.toString()).toBe('700');

    const response = await request(httpServer())
      .post(`/users/${userId}/orders/${orderId}/cancel`)
      .expect(200);

    expect(response.body).toEqual({
      order: { id: orderId, status: 'CANCELLED' },
    });

    const after = await readOrder(orderId);
    expect(after).toEqual({
      ...before,
      status: 'CANCELLED',
      xmin: after.xmin,
    });

    const resourcesAfter = await resourcesFor(userId);
    expect(resourcesAfter.accountingCash.toString()).toBe('1000');
    expect(resourcesAfter.reservedBuyCash.toString()).toBe('0');
    expect(resourcesAfter.availableCash.toString()).toBe('1000');
    expect(resourcesAfter.instruments).toEqual([]);
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
    const orderId = await insertOrder({
      userId,
      size: 6,
      price: '100',
      side: 'SELL',
      status: 'NEW',
      type: 'LIMIT',
    });

    const before = await resourcesFor(userId);
    expect(instrumentResources(before, ACTION_ID)).toEqual({
      instrumentId: ACTION_ID,
      executedQuantity: 10,
      sellReservedQuantity: 6,
      availableQuantity: 4,
    });

    await request(httpServer())
      .post(`/users/${userId}/orders/${orderId}/cancel`)
      .expect(200);

    const after = await resourcesFor(userId);
    expect(after.accountingCash.toString()).toBe('1000');
    expect(instrumentResources(after, ACTION_ID)).toEqual({
      instrumentId: ACTION_ID,
      executedQuantity: 10,
      sellReservedQuantity: 0,
      availableQuantity: 10,
    });
  });

  it('repeats CANCELLED with 200 and no additional write or effects', async () => {
    const userId = await createAccount(1_000);
    const orderId = await insertOrder({
      userId,
      size: 2,
      price: '100',
      side: 'BUY',
      status: 'NEW',
      type: 'LIMIT',
    });
    await request(httpServer())
      .post(`/users/${userId}/orders/${orderId}/cancel`)
      .expect(200);
    const rowBefore = await readOrder(orderId);
    const resourcesBefore = await resourcesFor(userId);

    const response = await request(httpServer())
      .post(`/users/${userId}/orders/${orderId}/cancel`)
      .expect(200);

    expect(response.body).toEqual({
      order: { id: orderId, status: 'CANCELLED' },
    });
    expect(await readOrder(orderId)).toEqual(rowBefore);
    expect(await resourcesFor(userId)).toEqual(resourcesBefore);
  });

  it('rejects FILLED and REJECTED with the exact 409 and no changes', async () => {
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

    const filled = await request(httpServer())
      .post(`/users/${userId}/orders/${filledId}/cancel`)
      .expect(409);
    const rejected = await request(httpServer())
      .post(`/users/${userId}/orders/${rejectedId}/cancel`)
      .expect(409);

    expect(filled.body).toEqual(NOT_CANCELLABLE);
    expect(rejected.body).toEqual(NOT_CANCELLABLE);
    expect(await readOrder(filledId)).toEqual(filledBefore);
    expect(await readOrder(rejectedId)).toEqual(rejectedBefore);
    expect(await resourcesFor(userId)).toEqual(resourcesBefore);
  });

  it('returns the same 404 for a foreign and a missing order without changes', async () => {
    const ownerId = await createAccount(1_000);
    const otherId = await createAccount(1_000);
    const orderId = await insertOrder({
      userId: ownerId,
      size: 2,
      price: '100',
      side: 'BUY',
      status: 'NEW',
      type: 'LIMIT',
    });
    const rowBefore = await readOrder(orderId);
    const resourcesBefore = await resourcesFor(ownerId);

    const foreign = await request(httpServer())
      .post(`/users/${otherId}/orders/${orderId}/cancel`)
      .expect(404);
    const missing = await request(httpServer())
      .post(`/users/${ownerId}/orders/999999/cancel`)
      .expect(404);

    expect(foreign.body).toEqual(NOT_FOUND);
    expect(missing.body).toEqual(NOT_FOUND);
    expect(await readOrder(orderId)).toEqual(rowBefore);
    expect(await resourcesFor(ownerId)).toEqual(resourcesBefore);
  });

  it('returns the same 404 for a missing account', async () => {
    const ownerId = await createAccount(1_000);
    const orderId = await insertOrder({
      userId: ownerId,
      size: 2,
      price: '100',
      side: 'BUY',
      status: 'NEW',
      type: 'LIMIT',
    });

    const response = await request(httpServer())
      .post(`/users/999998/orders/${orderId}/cancel`)
      .expect(404);

    expect(response.body).toEqual(NOT_FOUND);
    expect((await readOrder(orderId)).status).toBe('NEW');
  });

  it('cancels a historical NEW without identity through HTTP and preserves its fields', async () => {
    const userId = await createAccount(1_000);
    const orderId = await insertOrder({
      userId,
      size: 3,
      price: '123.45',
      side: 'BUY',
      status: 'NEW',
      type: 'LIMIT',
      datetime: '2023-07-12 15:14:20',
    });
    const before = await readOrder(orderId);

    await request(httpServer())
      .post(`/users/${userId}/orders/${orderId}/cancel`)
      .expect(200);

    const after = await readOrder(orderId);
    expect(after).toEqual({
      ...before,
      status: 'CANCELLED',
      xmin: after.xmin,
    });
    expect(after.idempotency_key).toBeNull();
    expect(after.idempotency_metadata).toBeNull();
  });

  it('does not modify data for invalid route identifiers', async () => {
    const userId = await createAccount(1_000);
    const orderId = await insertOrder({
      userId,
      size: 2,
      price: '100',
      side: 'BUY',
      status: 'NEW',
      type: 'LIMIT',
    });
    const rowBefore = await readOrder(orderId);

    const invalidUser = await request(httpServer())
      .post(`/users/0/orders/${orderId}/cancel`)
      .expect(400);
    const invalidOrder = await request(httpServer())
      .post(`/users/${userId}/orders/2147483648/cancel`)
      .expect(400);

    expect(invalidUser.body).toEqual(INVALID);
    expect(invalidOrder.body).toEqual(INVALID);
    expect(await readOrder(orderId)).toEqual(rowBefore);
  });
});

async function createAccount(cash: number): Promise<number> {
  const userId = nextUserId;
  nextUserId += 1;
  await pool!.query(
    'INSERT INTO users (id, email, accountnumber) VALUES ($1, $2, $3)',
    [userId, `b06b-${userId}@example.invalid`, `B06B${userId}`],
  );
  await insertOrder({
    userId,
    size: cash,
    price: null,
    side: 'CASH_IN',
    status: 'FILLED',
    type: 'MARKET',
    datetime: FIXED_DATETIME,
    instrumentId: CASH_ID,
  });

  return userId;
}

async function insertOrder(options: InsertOrderOptions): Promise<number> {
  const hasIdentity =
    options.idempotencyKey !== undefined &&
    options.idempotencyMetadata !== undefined;
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
          options.datetime ?? FIXED_DATETIME,
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
          options.datetime ?? FIXED_DATETIME,
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
