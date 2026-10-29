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
  INVALID_SUBMIT_ORDER_REQUEST_MESSAGE,
  SUBMIT_ORDER_CONFLICT_MESSAGE,
  SUBMIT_ORDER_NOT_FOUND_MESSAGE,
  SUBMIT_ORDER_UNAVAILABLE_MESSAGE,
} from '../../src/orders/infrastructure/http/http-messages.js';
import { CLOCK } from '../../src/orders/orders.tokens.js';
import type { AccountResources } from '../../src/resources/domain/account-resources.js';
import { calculateAccountResources } from '../../src/resources/domain/calculate-account-resources.js';
import { PostgresAccountMovementRepository } from '../../src/resources/infrastructure/persistence/postgres-account-movement.repository.js';
import { testDatabaseConfig } from '../support/test-database.js';

const SCHEMA = 'b05c_test';
const ACTION_ID = 9501;
const NO_QUOTE_ID = 9502;
const CASH_ID = 9503;
const OTHER_TYPE_ID = 9504;
const BAD_LATEST_ID = 9505;
const REPLAY_ID = 9506;
const FIXED_DATE = new Date('2026-10-29T12:34:56.789Z');
const FIXED_DATETIME = '2026-10-29 12:34:56.789';

const INVALID = { message: INVALID_SUBMIT_ORDER_REQUEST_MESSAGE };
const NOT_FOUND = { message: SUBMIT_ORDER_NOT_FOUND_MESSAGE };
const CONFLICT = { message: SUBMIT_ORDER_CONFLICT_MESSAGE };
const UNAVAILABLE = { message: SUBMIT_ORDER_UNAVAILABLE_MESSAGE };

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

interface SubmitBody {
  readonly instrumentId: number;
  readonly side: 'BUY' | 'SELL';
  readonly type: 'MARKET' | 'LIMIT';
  readonly size?: number;
  readonly amount?: string;
  readonly price?: string;
}

let adminPool: Pool | undefined;
let pool: Pool | undefined;
let app: INestApplication | undefined;
let movements: PostgresAccountMovementRepository;
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
     VALUES ($1, 'B05C', 'B05C action fixture', 'ACCIONES'),
            ($2, 'B05CNQ', 'B05C no-quote fixture', 'ACCIONES'),
            ($3, 'B05CCASH', 'B05C cash fixture', 'MONEDA'),
            ($4, 'B05CBOND', 'B05C other-type fixture', 'BONO'),
            ($5, 'B05CBAD', 'B05C invalid-quote fixture', 'ACCIONES'),
            ($6, 'B05CREPLAY', 'B05C replay fixture', 'ACCIONES')`,
    [
      ACTION_ID,
      NO_QUOTE_ID,
      CASH_ID,
      OTHER_TYPE_ID,
      BAD_LATEST_ID,
      REPLAY_ID,
    ],
  );
  await pool.query(
    `INSERT INTO marketdata
       (instrumentid, date, open, high, low, close, previousclose)
     VALUES
       ($1, '2023-07-13', 100.00, 100.00, 100.00, 100.00, 90.00),
       ($1, '2023-07-14', 300.00, 300.00, 300.00, 300.00, 100.00),
       ($2, '2023-07-13', 50.00, 50.00, 50.00, 50.00, 50.00),
       ($2, '2023-07-14', 0.00, 0.00, 0.00, 0.00, 0.00),
       ($3, '2023-07-14', 200.00, 200.00, 200.00, 200.00, 190.00)`,
    [ACTION_ID, BAD_LATEST_ID, REPLAY_ID],
  );

  const moduleFixture = await Test.createTestingModule({
    imports: [AppModule],
  })
    .overrideProvider(PG_POOL)
    .useValue(pool)
    .overrideProvider(CLOCK)
    .useValue({ now: () => new Date(FIXED_DATE) })
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

function submit(
  userId: number,
  key: string,
  body: SubmitBody,
): request.Test {
  return request(httpServer())
    .post(`/users/${userId}/orders`)
    .set('Idempotency-Key', key)
    .send(body);
}

describe('POST order submission against PostgreSQL', () => {
  it.each([
    ['BUY', 'MARKET', 'FILLED'],
    ['BUY', 'LIMIT', 'NEW'],
    ['SELL', 'MARKET', 'FILLED'],
    ['SELL', 'LIMIT', 'NEW'],
  ] as const)(
    'creates a %s %s size order as %s',
    async (side, type, expectedStatus) => {
      const userId = await createAccount(1_000);

      if (side === 'SELL') {
        await insertBuyFilled(userId, ACTION_ID, 10, '100.00');
      }

      const key = randomUUID();
      const body: SubmitBody = {
        instrumentId: ACTION_ID,
        side,
        type,
        size: 2,
        ...(type === 'LIMIT' ? { price: '100.00' } : {}),
      };

      const response = await submit(userId, key, body).expect(201);

      expect(response.body).toEqual({
        order: { id: expect.any(Number), status: expectedStatus },
      });
      const row = await readOrderByKey(userId, key);
      expect(row).toMatchObject({
        instrumentid: ACTION_ID,
        userid: userId,
        size: 2,
        price: type === 'MARKET' ? '300.00' : '100.00',
        type,
        side,
        status: expectedStatus,
        datetime: FIXED_DATETIME,
        idempotency_key: key,
      });
    },
  );

  it.each([
    ['BUY', 'MARKET', '600.00', undefined, 2, 'FILLED', '300.00'],
    ['BUY', 'LIMIT', '600.00', '100.00', 6, 'NEW', '100.00'],
    ['SELL', 'MARKET', '600.00', undefined, 2, 'FILLED', '300.00'],
    ['SELL', 'LIMIT', '600.00', '100.00', 6, 'NEW', '100.00'],
  ] as const)(
    'creates a %s %s amount order as %s with the derived quantity',
    async (side, type, amount, price, expectedSize, expectedStatus, storedPrice) => {
      const userId = await createAccount(10_000);

      if (side === 'SELL') {
        await insertBuyFilled(userId, ACTION_ID, 10, '100.00');
      }

      const key = randomUUID();
      const body: SubmitBody = {
        instrumentId: ACTION_ID,
        side,
        type,
        amount,
        ...(price === undefined ? {} : { price }),
      };

      const response = await submit(userId, key, body).expect(201);

      expect(response.body).toEqual({
        order: { id: expect.any(Number), status: expectedStatus },
      });
      const row = await readOrderByKey(userId, key);
      expect(row).toMatchObject({
        size: expectedSize,
        price: storedPrice,
        type,
        side,
        status: expectedStatus,
      });
      expect(row.idempotency_metadata).toMatchObject({
        version: 1,
        parameters: {
          mode: 'amount',
          amount: amount.replace(/\.0+$/, ''),
        },
      });
    },
  );

  it('persists an insufficient BUY as 201 REJECTED without execution or reservation', async () => {
    const userId = await createAccount(100);
    const key = randomUUID();

    const response = await submit(userId, key, {
      instrumentId: ACTION_ID,
      side: 'BUY',
      type: 'MARKET',
      size: 1,
    }).expect(201);

    const row = await readOrderByKey(userId, key);
    expect(response.body).toEqual({
      order: { id: row.id, status: 'REJECTED' },
    });
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

  it('persists an insufficient SELL as 201 REJECTED without execution or reservation', async () => {
    const userId = await createAccount(1_000);
    const key = randomUUID();

    const response = await submit(userId, key, {
      instrumentId: ACTION_ID,
      side: 'SELL',
      type: 'MARKET',
      size: 1,
    }).expect(201);

    expect(response.body).toMatchObject({
      order: { status: 'REJECTED' },
    });
    expect(await resourcesFor(userId)).toMatchObject({
      instruments: [],
    });
  });

  it('replays a NEW order with 200 and no additional write', async () => {
    const userId = await createAccount(1_000);
    const key = randomUUID();
    const body: SubmitBody = {
      instrumentId: ACTION_ID,
      side: 'BUY',
      type: 'LIMIT',
      size: 2,
      price: '100.00',
    };
    const first = await submit(userId, key, body).expect(201);
    const rowBefore = await readOrderByKey(userId, key);
    const resourcesBefore = await resourcesFor(userId);

    const replay = await submit(userId, key, body).expect(200);

    expect(replay.body).toEqual(first.body);
    expect(await readOrderByKey(userId, key)).toEqual(rowBefore);
    expect(await resourcesFor(userId)).toEqual(resourcesBefore);
    expect(await countByKey(userId, key)).toBe(1);
  });

  it('replays a FILLED order after deleting the quote and adding cash', async () => {
    const userId = await createAccount(10_000);
    const key = randomUUID();
    const body: SubmitBody = {
      instrumentId: REPLAY_ID,
      side: 'BUY',
      type: 'MARKET',
      size: 1,
    };
    const first = await submit(userId, key, body).expect(201);
    const rowBefore = await readOrderByKey(userId, key);
    expect(first.body).toMatchObject({ order: { status: 'FILLED' } });

    await pool!.query('DELETE FROM marketdata WHERE instrumentid = $1', [
      REPLAY_ID,
    ]);
    await insertCashIn(userId, 5_000);

    const replay = await submit(userId, key, body).expect(200);

    expect(replay.body).toEqual(first.body);
    expect(await readOrderByKey(userId, key)).toEqual(rowBefore);
    expect(await countByKey(userId, key)).toBe(1);
  });

  it('replays a REJECTED order after cash increases without reevaluating it', async () => {
    const userId = await createAccount(100);
    const key = randomUUID();
    const body: SubmitBody = {
      instrumentId: ACTION_ID,
      side: 'BUY',
      type: 'MARKET',
      size: 1,
    };
    const first = await submit(userId, key, body).expect(201);
    expect(first.body).toMatchObject({ order: { status: 'REJECTED' } });
    const rowBefore = await readOrderByKey(userId, key);

    await insertCashIn(userId, 10_000);

    const replay = await submit(userId, key, body).expect(200);

    expect(replay.body).toEqual(first.body);
    expect(await readOrderByKey(userId, key)).toEqual(rowBefore);
    expect(await countByKey(userId, key)).toBe(1);
  });

  it('replays a CANCELLED order without reopening it', async () => {
    const userId = await createAccount(1_000);
    const key = randomUUID();
    const body: SubmitBody = {
      instrumentId: ACTION_ID,
      side: 'BUY',
      type: 'LIMIT',
      size: 2,
      price: '100.00',
    };
    const created = await submit(userId, key, body).expect(201);
    const orderId = created.body.order.id as number;

    await request(httpServer())
      .post(`/users/${userId}/orders/${orderId}/cancel`)
      .expect(200);
    const rowBefore = await readOrderByKey(userId, key);
    expect(rowBefore.status).toBe('CANCELLED');

    const replay = await submit(userId, key, body).expect(200);

    expect(replay.body).toEqual({
      order: { id: orderId, status: 'CANCELLED' },
    });
    expect(await readOrderByKey(userId, key)).toEqual(rowBefore);
    expect(await countByKey(userId, key)).toBe(1);
    expect((await resourcesFor(userId)).reservedBuyCash.toString()).toBe('0');
  });

  it('returns 409 for the same key with a different intent and leaves the order intact', async () => {
    const userId = await createAccount(1_000);
    const key = randomUUID();
    const first = await submit(userId, key, {
      instrumentId: ACTION_ID,
      side: 'BUY',
      type: 'LIMIT',
      size: 2,
      price: '100.00',
    }).expect(201);
    const rowBefore = await readOrderByKey(userId, key);
    const resourcesBefore = await resourcesFor(userId);

    const conflict = await submit(userId, key, {
      instrumentId: ACTION_ID,
      side: 'BUY',
      type: 'LIMIT',
      size: 3,
      price: '100.00',
    }).expect(409);

    expect(conflict.body).toEqual(CONFLICT);
    expect(await readOrderByKey(userId, key)).toEqual(rowBefore);
    expect(await resourcesFor(userId)).toEqual(resourcesBefore);
    expect(await countByKey(userId, key)).toBe(1);
    expect(first.body.order.id).toBe(rowBefore.id);
  });

  it('treats the same key in another account as an independent operation', async () => {
    const firstUser = await createAccount(1_000);
    const secondUser = await createAccount(1_000);
    const key = randomUUID();
    const body: SubmitBody = {
      instrumentId: ACTION_ID,
      side: 'BUY',
      type: 'LIMIT',
      size: 1,
      price: '100.00',
    };

    const first = await submit(firstUser, key, body).expect(201);
    const second = await submit(secondUser, key, body).expect(201);

    expect(first.body.order.id).not.toBe(second.body.order.id);
    expect(await countByKey(firstUser, key)).toBe(1);
    expect(await countByKey(secondUser, key)).toBe(1);
  });

  it('creates a new order for a new key with the same intent', async () => {
    const userId = await createAccount(1_000);
    const firstKey = randomUUID();
    const secondKey = randomUUID();
    const body: SubmitBody = {
      instrumentId: ACTION_ID,
      side: 'BUY',
      type: 'LIMIT',
      size: 1,
      price: '100.00',
    };

    const first = await submit(userId, firstKey, body).expect(201);
    const second = await submit(userId, secondKey, body).expect(201);

    expect(first.body.order.id).not.toBe(second.body.order.id);
    expect(await countByKey(userId, firstKey)).toBe(1);
    expect(await countByKey(userId, secondKey)).toBe(1);
    expect((await resourcesFor(userId)).reservedBuyCash.toString()).toBe(
      '200',
    );
  });

  it('returns the same 404 for a missing user and a missing instrument', async () => {
    const key = randomUUID();
    const missingUser = await submit(999_999, key, {
      instrumentId: ACTION_ID,
      side: 'BUY',
      type: 'LIMIT',
      size: 1,
      price: '100.00',
    }).expect(404);

    expect(missingUser.body).toEqual(NOT_FOUND);

    const userId = await createAccount(1_000);
    const missingInstrumentKey = randomUUID();
    const missingInstrument = await submit(userId, missingInstrumentKey, {
      instrumentId: 999_999,
      side: 'BUY',
      type: 'LIMIT',
      size: 1,
      price: '100.00',
    }).expect(404);

    expect(missingInstrument.body).toEqual(NOT_FOUND);
    expect(await countByKey(userId, missingInstrumentKey)).toBe(0);
  });

  it.each([CASH_ID, OTHER_TYPE_ID])(
    'returns 400 for the non-tradable instrument %d without a row',
    async (instrumentId) => {
      const userId = await createAccount(1_000);
      const key = randomUUID();

      const response = await submit(userId, key, {
        instrumentId,
        side: 'BUY',
        type: 'LIMIT',
        size: 1,
        price: '100.00',
      }).expect(400);

      expect(response.body).toEqual(INVALID);
      expect(await countByKey(userId, key)).toBe(0);
    },
  );

  it('returns 500 for MARKET without a quote or with an invalid close, without consuming the UUID', async () => {
    const userId = await createAccount(1_000);
    const noQuoteKey = randomUUID();
    const invalidQuoteKey = randomUUID();

    const noQuote = await submit(userId, noQuoteKey, {
      instrumentId: NO_QUOTE_ID,
      side: 'BUY',
      type: 'MARKET',
      size: 1,
    }).expect(500);
    const invalidQuote = await submit(userId, invalidQuoteKey, {
      instrumentId: BAD_LATEST_ID,
      side: 'BUY',
      type: 'MARKET',
      size: 1,
    }).expect(500);

    expect(noQuote.body).toEqual(UNAVAILABLE);
    expect(invalidQuote.body).toEqual(UNAVAILABLE);
    expect(await countByKey(userId, noQuoteKey)).toBe(0);
    expect(await countByKey(userId, invalidQuoteKey)).toBe(0);

    await insertQuote(NO_QUOTE_ID, '2023-07-15', '100.00');

    const retry = await submit(userId, noQuoteKey, {
      instrumentId: NO_QUOTE_ID,
      side: 'BUY',
      type: 'MARKET',
      size: 1,
    }).expect(201);

    expect(retry.body).toMatchObject({ order: { status: 'FILLED' } });
    expect(await countByKey(userId, noQuoteKey)).toBe(1);
  });

  it.each([
    [
      'zero derived quantity',
      {
        instrumentId: ACTION_ID,
        side: 'BUY',
        type: 'LIMIT',
        amount: '100.00',
        price: '300.00',
      },
    ],
    [
      'derived quantity above INT',
      {
        instrumentId: ACTION_ID,
        side: 'BUY',
        type: 'LIMIT',
        amount: '999999999999999999999999999999',
        price: '0.01',
      },
    ],
    [
      'size above INT',
      {
        instrumentId: ACTION_ID,
        side: 'BUY',
        type: 'MARKET',
        size: 2_147_483_648,
      },
    ],
  ] as const)(
    'returns 400 for %s without a row',
    async (_label, body) => {
      const userId = await createAccount(1_000);
      const key = randomUUID();

      const response = await submit(userId, key, body).expect(400);

      expect(response.body).toEqual(INVALID);
      expect(await countByKey(userId, key)).toBe(0);
    },
  );

  it('returns 400 for a malformed UUID without a PostgreSQL error', async () => {
    const userId = await createAccount(1_000);

    const response = await submit(userId, 'not-a-uuid', {
      instrumentId: ACTION_ID,
      side: 'BUY',
      type: 'LIMIT',
      size: 1,
      price: '100.00',
    }).expect(400);

    expect(response.body).toEqual(INVALID);
    expect(await countIdentities(userId)).toBe(0);
  });

  it('creates one row for two concurrent submissions with the same key', async () => {
    const userId = await createAccount(10_000);
    const key = randomUUID();
    const body: SubmitBody = {
      instrumentId: ACTION_ID,
      side: 'BUY',
      type: 'MARKET',
      size: 1,
    };

    const [first, second] = await Promise.all([
      submit(userId, key, body),
      submit(userId, key, body),
    ]);

    expect([first.status, second.status].sort()).toEqual([200, 201]);
    expect(first.body).toEqual(second.body);
    expect(await countByKey(userId, key)).toBe(1);
    expect((await resourcesFor(userId)).accountingCash.toString()).toBe(
      '9700',
    );
  });
});

async function createAccount(cash: number): Promise<number> {
  const userId = nextUserId;
  nextUserId += 1;
  await pool!.query('INSERT INTO users (id) VALUES ($1)', [userId]);
  await insertCashIn(userId, cash);

  return userId;
}

async function insertCashIn(userId: number, size: number): Promise<void> {
  await insertOrder({
    userId,
    size,
    instrumentId: CASH_ID,
    price: null,
    side: 'CASH_IN',
    status: 'FILLED',
    type: 'MARKET',
  });
}

async function insertBuyFilled(
  userId: number,
  instrumentId: number,
  size: number,
  price: string,
): Promise<void> {
  await insertOrder({
    userId,
    size,
    instrumentId,
    price,
    side: 'BUY',
    status: 'FILLED',
    type: 'MARKET',
  });
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
            idempotency_metadata,
            xmin::text AS xmin
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

async function countIdentities(userId: number): Promise<number> {
  const result = await pool!.query<{ count: number }>(
    `SELECT count(*)::int AS count
       FROM orders
      WHERE userid = $1
        AND idempotency_key IS NOT NULL`,
    [userId],
  );

  return result.rows[0]?.count ?? 0;
}

async function resourcesFor(userId: number): Promise<AccountResources> {
  return calculateAccountResources(await movements.findByUserId(userId));
}
