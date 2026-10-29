import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { Pool } from 'pg';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AppModule } from '../../src/app.module.js';
import { configureHttpApplication } from '../../src/bootstrap/configure-http.js';
import { PG_POOL } from '../../src/database/database.tokens.js';
import {
  INVALID_PORTFOLIO_REQUEST_MESSAGE,
  PORTFOLIO_UNAVAILABLE_MESSAGE,
  PORTFOLIO_USER_NOT_FOUND_MESSAGE,
} from '../../src/portfolio/infrastructure/http/http-messages.js';
import { testDatabaseConfig } from '../support/test-database.js';

const SCHEMA = 'b07b_http_test';

const INVALID = { message: INVALID_PORTFOLIO_REQUEST_MESSAGE };
const NOT_FOUND = { message: PORTFOLIO_USER_NOT_FOUND_MESSAGE };
const UNAVAILABLE = { message: PORTFOLIO_UNAVAILABLE_MESSAGE };

interface OrderFixture {
  readonly id: number;
  readonly instrumentId: number;
  readonly userId: number;
  readonly side: 'BUY' | 'SELL' | 'CASH_IN' | 'CASH_OUT';
  readonly status: 'NEW' | 'FILLED' | 'REJECTED' | 'CANCELLED';
  readonly type: 'MARKET' | 'LIMIT';
  readonly size: number;
  readonly price: string | null;
  readonly datetime: string;
}

interface QuoteFixture {
  readonly id: number;
  readonly instrumentId: number;
  readonly date: string;
  readonly close: string | null;
  readonly previousClose: string | null;
}

interface TableRow {
  readonly [column: string]: unknown;
}

let adminPool: Pool | undefined;
let pool: Pool | undefined;
let app: INestApplication | undefined;

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

  const moduleFixture = await Test.createTestingModule({
    imports: [AppModule],
  })
    .overrideProvider(PG_POOL)
    .useValue(pool)
    .compile();

  app = moduleFixture.createNestApplication();
  configureHttpApplication(app);
  await app.init();
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

describe('GET portfolio against PostgreSQL', () => {
  it('returns the approved seed result and does not modify rows', async () => {
    const before = await snapshotTables();

    const response = await request(httpServer())
      .get('/users/1/portfolio')
      .expect(200);

    expect(response.body).toEqual({
      totalValue: '889756.00',
      availableCash: '627500.00',
      positions: [
        {
          instrumentId: 31,
          ticker: 'BMA',
          name: 'Banco Macro S.A.',
          quantity: -10,
          positionValue: '-15028.00',
          totalReturnPercent: null,
          dailyReturnPercent: -1.15,
        },
        {
          instrumentId: 47,
          ticker: 'PAMP',
          name: 'Pampa Holding S.A.',
          quantity: 40,
          positionValue: '37034.00',
          totalReturnPercent: -0.45,
          dailyReturnPercent: 0.44,
        },
        {
          instrumentId: 54,
          ticker: 'METR',
          name: 'MetroGAS S.A.',
          quantity: 500,
          positionValue: '114750.00',
          totalReturnPercent: -8.2,
          dailyReturnPercent: -1.08,
        },
      ],
    });
    expect(Object.keys(response.body)).toEqual([
      'totalValue',
      'availableCash',
      'positions',
    ]);
    expect(await snapshotTables()).toEqual(before);
  });

  it('returns zero values for an existing user without movements', async () => {
    const response = await request(httpServer())
      .get('/users/2/portfolio')
      .expect(200);

    expect(response.body).toEqual({
      totalValue: '0.00',
      availableCash: '0.00',
      positions: [],
    });
  });

  it('returns the exact 404 for a missing user', async () => {
    const response = await request(httpServer())
      .get('/users/999999/portfolio')
      .expect(404);

    expect(response.body).toEqual(NOT_FOUND);
    expect(Object.keys(response.body)).toEqual(['message']);
  });

  it('fails the complete read when a required close is absent', async () => {
    await createAccount(9700, 9701, { cash: '1000.00' });
    await insertOrders([
      order(9701, 9701, 9700, 'BUY', 'FILLED', 1, '100.00'),
    ]);

    const response = await request(httpServer())
      .get('/users/9700/portfolio')
      .expect(500);

    expect(response.body).toEqual(UNAVAILABLE);
    expect(response.text).not.toContain('9701');
    expect(response.text).not.toContain('close');
  });

  it('fails without falling back when the selected close is invalid', async () => {
    await createAccount(9702, 9703, { cash: '1000.00' });
    await insertOrders([
      order(9703, 9703, 9702, 'BUY', 'FILLED', 1, '100.00'),
    ]);
    await insertQuotes([
      quote(9701, 9703, '2023-07-13', '50.00', '49.00'),
      quote(9702, 9703, '2023-07-14', '0.00', '49.00'),
    ]);

    const response = await request(httpServer())
      .get('/users/9702/portfolio')
      .expect(500);

    expect(response.body).toEqual(UNAVAILABLE);
  });

  it('keeps positions with a null daily return when previousClose is absent or invalid', async () => {
    await pool!.query(
      `INSERT INTO users (id, email, accountnumber)
       VALUES (9710, 'b07b-prev@test.invalid', '9710')`,
    );
    await pool!.query(
      `INSERT INTO instruments (id, ticker, name, type)
       VALUES (9711, 'BPREV', 'B07B previous null', 'ACCIONES'),
              (9712, 'BPREV0', 'B07B previous zero', 'ACCIONES')`,
    );
    await insertOrders([
      order(9711, 9711, 9710, 'CASH_IN', 'FILLED', 1_000, null),
      order(9712, 9711, 9710, 'BUY', 'FILLED', 2, '100.00'),
      order(9713, 9712, 9710, 'BUY', 'FILLED', 1, '100.00'),
    ]);
    await insertQuotes([
      quote(9711, 9711, '2023-07-14', '150.00', null),
      quote(9712, 9712, '2023-07-14', '120.00', '0.00'),
    ]);

    const response = await request(httpServer())
      .get('/users/9710/portfolio')
      .expect(200);

    expect(response.body).toEqual({
      totalValue: '1120.00',
      availableCash: '700.00',
      positions: [
        {
          instrumentId: 9711,
          ticker: 'BPREV',
          name: 'B07B previous null',
          quantity: 2,
          positionValue: '300.00',
          totalReturnPercent: 50,
          dailyReturnPercent: null,
        },
        {
          instrumentId: 9712,
          ticker: 'BPREV0',
          name: 'B07B previous zero',
          quantity: 1,
          positionValue: '120.00',
          totalReturnPercent: 20,
          dailyReturnPercent: null,
        },
      ],
    });
  });

  it('omits a zero position without requiring a quote', async () => {
    await createAccount(9720, 9721, { cash: null });
    await insertOrders([
      order(9721, 9721, 9720, 'BUY', 'FILLED', 5, '100.00'),
      order(9722, 9721, 9720, 'SELL', 'FILLED', 5, '120.00'),
    ]);

    const response = await request(httpServer())
      .get('/users/9720/portfolio')
      .expect(200);

    expect(response.body).toEqual({
      totalValue: '100.00',
      availableCash: '100.00',
      positions: [],
    });
  });

  it('preserves null ticker and name and calculates from the selected quote', async () => {
    await createAccount(9730, 9731, { cash: '100.00', ticker: null, name: null });
    await insertOrders([
      order(9731, 9731, 9730, 'BUY', 'FILLED', 1, '100.00'),
    ]);
    await insertQuotes([
      quote(9731, 9731, '2023-07-14', '10.00', '9.00'),
    ]);

    const response = await request(httpServer())
      .get('/users/9730/portfolio')
      .expect(200);

    expect(response.body).toEqual({
      totalValue: '10.00',
      availableCash: '0.00',
      positions: [
        {
          instrumentId: 9731,
          ticker: null,
          name: null,
          quantity: 1,
          positionValue: '10.00',
          totalReturnPercent: -90,
          dailyReturnPercent: 11.11,
        },
      ],
    });
  });

  it('shows MARKET effects, reserves LIMIT cash and releases it on cancellation', async () => {
    await createAccount(9740, 9741, { cash: '1000.00' });
    await insertQuotes([
      quote(9741, 9741, '2023-07-14', '100.00', '90.00'),
    ]);

    const market = await request(httpServer())
      .post('/users/9740/orders')
      .set('Idempotency-Key', randomUUID())
      .send({
        instrumentId: 9741,
        side: 'BUY',
        type: 'MARKET',
        size: 3,
      })
      .expect(201);

    expect(market.body).toEqual({
      order: { id: expect.any(Number), status: 'FILLED' },
    });

    const afterMarket = await request(httpServer())
      .get('/users/9740/portfolio')
      .expect(200);

    expect(afterMarket.body).toEqual({
      totalValue: '1000.00',
      availableCash: '700.00',
      positions: [
        {
          instrumentId: 9741,
          ticker: 'B07B',
          name: 'B07B market',
          quantity: 3,
          positionValue: '300.00',
          totalReturnPercent: 0,
          dailyReturnPercent: 11.11,
        },
      ],
    });

    const limit = await request(httpServer())
      .post('/users/9740/orders')
      .set('Idempotency-Key', randomUUID())
      .send({
        instrumentId: 9741,
        side: 'BUY',
        type: 'LIMIT',
        size: 2,
        price: '50.00',
      })
      .expect(201);

    expect(limit.body).toEqual({
      order: { id: expect.any(Number), status: 'NEW' },
    });

    const withReserve = await request(httpServer())
      .get('/users/9740/portfolio')
      .expect(200);

    expect(withReserve.body).toEqual({
      totalValue: '1000.00',
      availableCash: '600.00',
      positions: [
        {
          instrumentId: 9741,
          ticker: 'B07B',
          name: 'B07B market',
          quantity: 3,
          positionValue: '300.00',
          totalReturnPercent: 0,
          dailyReturnPercent: 11.11,
        },
      ],
    });

    await request(httpServer())
      .post(`/users/9740/orders/${limit.body.order.id}/cancel`)
      .expect(200);

    const afterCancel = await request(httpServer())
      .get('/users/9740/portfolio')
      .expect(200);

    expect(afterCancel.body).toEqual(afterMarket.body);
  });
});

describe('GET portfolio HTTP validation against PostgreSQL', () => {
  it.each([
    '/users/0/portfolio',
    '/users/000/portfolio',
    '/users/-1/portfolio',
    '/users/1.0/portfolio',
    '/users/2147483648/portfolio',
    '/users/abc/portfolio',
  ])('returns the exact 400 without reading the database for %s', async (path) => {
    const response = await request(httpServer()).get(path).expect(400);

    expect(response.body).toEqual(INVALID);
  });
});

async function snapshotTables(): Promise<{
  orders: TableRow[];
  marketdata: TableRow[];
  users: TableRow[];
}> {
  const orders = await pool!.query<TableRow>(
    `SELECT id, instrumentid, userid, side, status, type, size,
            price::text AS price, datetime::text AS datetime,
            xmin::text AS xmin
       FROM orders
      ORDER BY id`,
  );
  const marketdata = await pool!.query<TableRow>(
    `SELECT id, instrumentid, date::text AS date, close::text AS close,
            previousclose::text AS previousclose, xmin::text AS xmin
       FROM marketdata
      ORDER BY id`,
  );
  const users = await pool!.query<TableRow>(
    `SELECT id, email, accountnumber, xmin::text AS xmin
       FROM users
      ORDER BY id`,
  );

  return {
    orders: orders.rows,
    marketdata: marketdata.rows,
    users: users.rows,
  };
}

async function createAccount(
  userId: number,
  instrumentId: number,
  options: {
    readonly cash: string | null;
    readonly ticker?: string | null;
    readonly name?: string | null;
  },
): Promise<void> {
  await pool!.query(
    `INSERT INTO users (id, email, accountnumber)
     VALUES ($1, $2, $3)`,
    [userId, `b07b-${userId}@test.invalid`, String(userId)],
  );
  await pool!.query(
    `INSERT INTO instruments (id, ticker, name, type)
     VALUES ($1, $2, $3, 'ACCIONES')`,
    [
      instrumentId,
      options.ticker === undefined ? 'B07B' : options.ticker,
      options.name === undefined ? 'B07B market' : options.name,
    ],
  );

  if (options.cash !== null) {
    await insertOrders([
      {
        id: userId,
        instrumentId,
        userId,
        side: 'CASH_IN',
        status: 'FILLED',
        type: 'MARKET',
        size: Number(options.cash),
        price: null,
        datetime: '2023-07-01 00:00:00.000000',
      },
    ]);
  }
}

function order(
  id: number,
  instrumentId: number,
  userId: number,
  side: OrderFixture['side'],
  status: OrderFixture['status'],
  size: number,
  price: string | null,
): OrderFixture {
  return {
    id,
    instrumentId,
    userId,
    side,
    status,
    type: 'MARKET',
    size,
    price,
    datetime: '2023-07-02 00:00:00.000000',
  };
}

function quote(
  id: number,
  instrumentId: number,
  date: string,
  close: string | null,
  previousClose: string | null,
): QuoteFixture {
  return { id, instrumentId, date, close, previousClose };
}

async function insertOrders(
  orders: readonly OrderFixture[],
): Promise<void> {
  for (const item of orders) {
    await pool!.query(
      `INSERT INTO orders
         (id, instrumentid, userid, side, status, type, size, price, datetime)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [
        item.id,
        item.instrumentId,
        item.userId,
        item.side,
        item.status,
        item.type,
        item.size,
        item.price,
        item.datetime,
      ],
    );
  }
}

async function insertQuotes(
  quotes: readonly QuoteFixture[],
): Promise<void> {
  for (const item of quotes) {
    await pool!.query(
      `INSERT INTO marketdata
         (id, instrumentid, date, close, previousclose)
       VALUES ($1, $2, $3, $4, $5)`,
      [
        item.id,
        item.instrumentId,
        item.date,
        item.close,
        item.previousClose,
      ],
    );
  }
}
