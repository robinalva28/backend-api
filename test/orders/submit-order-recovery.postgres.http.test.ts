import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { Pool } from 'pg';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { AppModule } from '../../src/app.module.js';
import { configureHttpApplication } from '../../src/bootstrap/configure-http.js';
import { PG_POOL } from '../../src/database/database.tokens.js';
import { buildOrderIntentMetadata } from '../../src/orders/domain/order-intent-metadata.js';
import {
  createOrderIntent,
  type OrderIntent,
} from '../../src/orders/domain/order-intent.js';
import {
  SUBMIT_ORDER_CONFLICT_MESSAGE,
  SUBMIT_ORDER_UNAVAILABLE_MESSAGE,
} from '../../src/orders/infrastructure/http/http-messages.js';
import { CLOCK } from '../../src/orders/orders.tokens.js';
import { PostgresAccountTransactionRunner } from '../../src/transactions/infrastructure/persistence/postgres-account-transaction.runner.js';
import { ACCOUNT_TRANSACTION_RUNNER } from '../../src/transactions/transactions.tokens.js';
import { FaultInjectingPool } from '../support/fault-injecting-pool.js';
import { testDatabaseConfig } from '../support/test-database.js';

const SCHEMA = 'b08b_http_test';
const ACTION_ID = 9851;
const CASH_ID = 9852;
const FIXED_DATE = new Date('2026-10-29T21:15:30.456Z');

const CONFLICT = { message: SUBMIT_ORDER_CONFLICT_MESSAGE };
const UNAVAILABLE = { message: SUBMIT_ORDER_UNAVAILABLE_MESSAGE };

interface SubmitBody {
  readonly instrumentId: number;
  readonly side: 'BUY';
  readonly type: 'MARKET' | 'LIMIT';
  readonly size: number;
  readonly price?: string;
}

interface OrderRow {
  id: number;
  status: string;
  size: number;
  price: string;
}

let adminPool: Pool | undefined;
let pool: Pool | undefined;
let app: INestApplication | undefined;
let faults: FaultInjectingPool;
let nextUserId = 9871;

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
     VALUES ($1, 'B08BH', 'B08B HTTP action fixture', 'ACCIONES'),
            ($2, 'B08BC', 'B08B HTTP cash fixture', 'MONEDA')`,
    [ACTION_ID, CASH_ID],
  );
  await pool.query(
    `INSERT INTO marketdata
       (instrumentid, date, open, high, low, close, previousclose)
     VALUES ($1, '2023-07-14', 300.00, 300.00, 300.00, 300.00, 100.00)`,
    [ACTION_ID],
  );

  faults = new FaultInjectingPool(pool);
  const moduleFixture = await Test.createTestingModule({
    imports: [AppModule],
  })
    .overrideProvider(PG_POOL)
    .useValue(pool)
    .overrideProvider(ACCOUNT_TRANSACTION_RUNNER)
    .useValue(new PostgresAccountTransactionRunner(faults))
    .overrideProvider(CLOCK)
    .useValue({ now: () => new Date(FIXED_DATE) })
    .compile();

  app = moduleFixture.createNestApplication();
  configureHttpApplication(app);
  await app.init();
});

beforeEach(() => {
  faults.reset();
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

describe('POST order submission with uncertain COMMIT against PostgreSQL', () => {
  it('returns 200 with the recovered order after the COMMIT response is lost', async () => {
    const userId = await createAccount(10_000);
    const key = randomUUID();
    faults.commitFault = 'lose-response-after-commit';

    const response = await submit(userId, key, marketBody()).expect(200);

    expect(response.body).toEqual({
      order: { id: expect.any(Number), status: 'FILLED' },
    });
    expect(await countByKey(userId, key)).toBe(1);
    expect(await readOrderByKey(userId, key)).toMatchObject({
      status: 'FILLED',
      size: 2,
      price: '300.00',
    });
  });

  it('returns the approved 409 body when the recovered intent differs', async () => {
    const userId = await createAccount(10_000);
    const key = randomUUID();
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
        [
          row.id,
          JSON.stringify(
            buildOrderIntentMetadata(
              intentFor({ size: '3' }),
            ),
          ),
        ],
      );
    };

    const response = await submit(userId, key, marketBody()).expect(409);

    expect(response.body).toEqual(CONFLICT);
    expect(await countByKey(userId, key)).toBe(1);
    expect(await readOrderByKey(userId, key)).toMatchObject({
      status: 'FILLED',
      size: 2,
    });
  });

  it('returns the exact generic 500 body when recovery finds no order', async () => {
    const userId = await createAccount(1_000);
    const key = randomUUID();
    faults.commitFault = 'fail-before-commit';

    const response = await submit(userId, key, limitBody()).expect(500);

    expect(response.body).toEqual(UNAVAILABLE);
    expect(await countByKey(userId, key)).toBe(0);
    expect(await resourcesCash(userId)).toBe('1000');
  });
});

function marketBody(): SubmitBody {
  return {
    instrumentId: ACTION_ID,
    side: 'BUY',
    type: 'MARKET',
    size: 2,
  };
}

function limitBody(): SubmitBody {
  return {
    instrumentId: ACTION_ID,
    side: 'BUY',
    type: 'LIMIT',
    size: 2,
    price: '100.00',
  };
}

function intentFor(overrides: {
  readonly size?: string;
} = {}): OrderIntent {
  return createOrderIntent({
    instrumentId: ACTION_ID,
    side: 'BUY',
    type: 'MARKET',
    size: overrides.size ?? '2',
  });
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
    `SELECT id, status, size, price::text AS price
       FROM orders
      WHERE userid = $1
        AND idempotency_key = $2::uuid`,
    [userId, key],
  );

  return result.rows[0];
}

async function resourcesCash(userId: number): Promise<string> {
  const result = await pool!.query<{ available: string }>(
    `SELECT COALESCE(SUM(CASE
              WHEN side = 'CASH_IN' AND status = 'FILLED' THEN size
              WHEN side = 'CASH_OUT' AND status = 'FILLED' THEN -size
              ELSE 0
            END), 0)::text AS available
       FROM orders
      WHERE userid = $1`,
    [userId],
  );

  return result.rows[0]?.available ?? '0';
}
