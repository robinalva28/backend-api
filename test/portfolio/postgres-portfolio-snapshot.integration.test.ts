import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { Pool, type PoolClient } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { calculatePortfolio } from '../../src/portfolio/domain/calculate-portfolio.js';
import {
  PostgresPortfolioSnapshotRepository,
  type PortfolioConnectionPool,
  type PortfolioTransactionClient,
} from '../../src/portfolio/infrastructure/persistence/postgres-portfolio-snapshot.repository.js';
import { testDatabaseConfig } from '../support/test-database.js';

const SCHEMA = 'b07b_test';

interface OrderFixture {
  readonly id: number;
  readonly instrumentId: number;
  readonly userId: number;
  readonly side: 'BUY' | 'SELL' | 'CASH_IN' | 'CASH_OUT';
  readonly status: 'NEW' | 'FILLED' | 'REJECTED' | 'CANCELLED';
  readonly type?: 'MARKET' | 'LIMIT' | null;
  readonly size: number;
  readonly price: string | null;
  readonly datetime: string;
}

interface QuoteFixture {
  readonly id: number;
  readonly instrumentId: number;
  readonly date: string | null;
  readonly close: string | null;
  readonly previousClose: string | null;
}

let adminPool: Pool | undefined;
let pool: Pool | undefined;
let repository: PostgresPortfolioSnapshotRepository;

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
  repository = new PostgresPortfolioSnapshotRepository(pool);
});

afterAll(async () => {
  try {
    await pool?.end();
  } finally {
    await adminPool?.query(`DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE`);
    await adminPool?.end();
  }
});

describe('Postgres portfolio snapshot against PostgreSQL', () => {
  it('reads the seed movements, position metadata and latest quotes in one snapshot', async () => {
    const snapshot = await repository.findByUserId(1);

    expect(snapshot).not.toBeNull();
    expect(snapshot?.movements).toHaveLength(11);
    expect(snapshot?.movements.map(({ id }) => id)).toEqual([
      1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11,
    ]);
    expect(snapshot?.movements[0]).toMatchObject({
      instrumentId: 66,
      side: 'CASH_IN',
      status: 'FILLED',
      size: 1_000_000,
    });
    expect(snapshot?.movements.at(-1)).toMatchObject({
      instrumentId: 31,
      side: 'SELL',
      status: 'FILLED',
      size: 30,
    });
    expect(snapshot?.instruments.map(({ id }) => id)).toEqual([31, 47, 54]);
    expect(
      snapshot?.quotes.map(({ instrumentId }) => instrumentId).sort(
        (left, right) => left - right,
      ),
    ).toEqual([31, 47, 54]);
    expect(
      snapshot?.quotes.find(({ instrumentId }) => instrumentId === 31),
    ).toMatchObject({
      date: '2023-07-14',
      close: '1502.80',
      previousClose: '1520.25',
    });
    expect(
      snapshot?.quotes.find(({ instrumentId }) => instrumentId === 47),
    ).toMatchObject({
      date: '2023-07-14',
      close: '925.85',
      previousClose: '921.80',
    });
    expect(
      snapshot?.quotes.find(({ instrumentId }) => instrumentId === 54),
    ).toMatchObject({
      date: '2023-07-14',
      close: '229.50',
      previousClose: '232.00',
    });
  });

  it('distinguishes an existing user without movements from a missing user', async () => {
    await expect(repository.findByUserId(2)).resolves.toEqual({
      movements: [],
      instruments: [],
      quotes: [],
    });
    await expect(repository.findByUserId(999999)).resolves.toBeNull();
  });

  it('selects the latest native date and id, excludes null dates and never falls back', async () => {
    await pool!.query(
      `INSERT INTO users (id, email, accountnumber)
       VALUES (9300, 'b07b-quotes@test.invalid', '9300')`,
    );
    await pool!.query(
      `INSERT INTO instruments (id, ticker, name, type)
       VALUES (9301, 'QDATE', 'Quote date', 'ACCIONES'),
              (9302, 'QTIE', 'Quote tie', 'ACCIONES'),
              (9303, 'QNULL', 'Quote null date', 'ACCIONES'),
              (9304, 'QFALL', 'Quote no fallback', 'ACCIONES'),
              (9305, 'QYEAR', 'Quote extended year', 'ACCIONES')`,
    );
    await insertOrders(
      [9301, 9302, 9303, 9304, 9305].map((instrumentId) => ({
        id: 9300 + instrumentId,
        instrumentId,
        userId: 9300,
        side: 'BUY',
        status: 'FILLED',
        type: 'MARKET',
        size: 1,
        price: '1.00',
        datetime: '2023-07-01 00:00:00.000000',
      })),
    );
    await insertQuotes([
      {
        id: 9301,
        instrumentId: 9301,
        date: '2023-07-13',
        close: '10.00',
        previousClose: '9.00',
      },
      {
        id: 9302,
        instrumentId: 9301,
        date: '2023-07-14',
        close: '20.00',
        previousClose: '19.00',
      },
      {
        id: 9303,
        instrumentId: 9302,
        date: '2023-07-15',
        close: '30.00',
        previousClose: '29.00',
      },
      {
        id: 9304,
        instrumentId: 9302,
        date: '2023-07-15',
        close: '40.00',
        previousClose: '39.00',
      },
      {
        id: 9305,
        instrumentId: 9303,
        date: null,
        close: '999.00',
        previousClose: '998.00',
      },
      {
        id: 9306,
        instrumentId: 9303,
        date: '2023-07-01',
        close: '5.00',
        previousClose: '4.00',
      },
      {
        id: 9307,
        instrumentId: 9304,
        date: '2023-08-01',
        close: null,
        previousClose: '7.00',
      },
      {
        id: 9308,
        instrumentId: 9304,
        date: '2023-07-01',
        close: '7.00',
        previousClose: '6.00',
      },
      {
        id: 9309,
        instrumentId: 9305,
        date: '9999-12-31',
        close: '1.00',
        previousClose: '0.90',
      },
      {
        id: 9310,
        instrumentId: 9305,
        date: '10000-01-01',
        close: '2.00',
        previousClose: '1.00',
      },
    ]);

    const snapshot = await repository.findByUserId(9300);
    const quotes = new Map(
      snapshot?.quotes.map((quote) => [quote.instrumentId, quote]),
    );

    expect(quotes.get(9301)).toMatchObject({
      id: 9302,
      date: '2023-07-14',
      close: '20.00',
    });
    expect(quotes.get(9302)).toMatchObject({
      id: 9304,
      date: '2023-07-15',
      close: '40.00',
    });
    expect(quotes.get(9303)).toMatchObject({
      id: 9306,
      date: '2023-07-01',
      close: '5.00',
    });
    expect(quotes.get(9304)).toMatchObject({
      id: 9307,
      date: '2023-08-01',
      close: null,
      previousClose: '7.00',
    });
    expect(quotes.get(9305)).toMatchObject({
      id: 9310,
      date: '10000-01-01',
      close: '2.00',
    });
  });

  it('orders native timestamps with microseconds before id when timestamps differ', async () => {
    await pool!.query(
      `INSERT INTO users (id, email, accountnumber)
       VALUES (9400, 'b07b-time@test.invalid', '9400')`,
    );
    await pool!.query(
      `INSERT INTO instruments (id, ticker, name, type)
       VALUES (9401, 'BTIME', 'B07B time', 'ACCIONES')`,
    );
    await insertOrders([
      {
        id: 9402,
        instrumentId: 9401,
        userId: 9400,
        side: 'BUY',
        status: 'FILLED',
        type: 'MARKET',
        size: 10,
        price: '100.00',
        datetime: '2023-07-12 12:31:20.000002',
      },
      {
        id: 9403,
        instrumentId: 9401,
        userId: 9400,
        side: 'SELL',
        status: 'FILLED',
        type: 'MARKET',
        size: 5,
        price: '120.00',
        datetime: '2023-07-12 12:31:20.000001',
      },
    ]);
    await insertQuotes([
      {
        id: 9401,
        instrumentId: 9401,
        date: '2023-07-14',
        close: '200.00',
        previousClose: '190.00',
      },
    ]);

    const snapshot = await repository.findByUserId(9400);

    expect(snapshot?.movements.map(({ id }) => id)).toEqual([9403, 9402]);
    expect(snapshot?.movements.map(({ datetime }) => datetime)).toEqual([
      '2023-07-12T12:31:20.000001',
      '2023-07-12T12:31:20.000002',
    ]);
    expect(calculatePortfolio(snapshot!).positions[0]).toMatchObject({
      quantity: 5,
      totalReturnPercent: null,
    });
  });

  it('uses id ascending only for a real timestamp tie', async () => {
    await pool!.query(
      `INSERT INTO users (id, email, accountnumber)
       VALUES (9410, 'b07b-tie@test.invalid', '9410')`,
    );
    await pool!.query(
      `INSERT INTO instruments (id, ticker, name, type)
       VALUES (9411, 'BTIE', 'B07B tie', 'ACCIONES')`,
    );
    await insertOrders([
      {
        id: 9420,
        instrumentId: 9411,
        userId: 9410,
        side: 'BUY',
        status: 'FILLED',
        type: 'MARKET',
        size: 10,
        price: '100.00',
        datetime: '2023-07-12 12:31:20.500000',
      },
      {
        id: 9419,
        instrumentId: 9411,
        userId: 9410,
        side: 'SELL',
        status: 'FILLED',
        type: 'MARKET',
        size: 5,
        price: '120.00',
        datetime: '2023-07-12 12:31:20.500000',
      },
    ]);
    await insertQuotes([
      {
        id: 9411,
        instrumentId: 9411,
        date: '2023-07-14',
        close: '200.00',
        previousClose: '190.00',
      },
    ]);

    const snapshot = await repository.findByUserId(9410);

    expect(snapshot?.movements.map(({ id }) => id)).toEqual([9419, 9420]);
    expect(calculatePortfolio(snapshot!).positions[0]).toMatchObject({
      quantity: 5,
      totalReturnPercent: null,
    });
  });

  it('does not require quotes for a zero position or a cash-only account', async () => {
    await pool!.query(
      `INSERT INTO users (id, email, accountnumber)
       VALUES (9500, 'b07b-zero@test.invalid', '9500'),
              (9510, 'b07b-cash@test.invalid', '9510')`,
    );
    await pool!.query(
      `INSERT INTO instruments (id, ticker, name, type)
       VALUES (9501, 'BZERO', 'B07B zero', 'ACCIONES'),
              (9511, 'BCASH', 'B07B cash', 'MONEDA')`,
    );
    await insertOrders([
      {
        id: 9501,
        instrumentId: 9501,
        userId: 9500,
        side: 'BUY',
        status: 'FILLED',
        type: 'MARKET',
        size: 5,
        price: '100.00',
        datetime: '2023-07-01 00:00:00.000000',
      },
      {
        id: 9502,
        instrumentId: 9501,
        userId: 9500,
        side: 'SELL',
        status: 'FILLED',
        type: 'MARKET',
        size: 5,
        price: '120.00',
        datetime: '2023-07-02 00:00:00.000000',
      },
      {
        id: 9511,
        instrumentId: 9511,
        userId: 9510,
        side: 'CASH_IN',
        status: 'FILLED',
        type: 'MARKET',
        size: 1_000,
        price: null,
        datetime: '2023-07-01 00:00:00.000000',
      },
    ]);

    const zero = await repository.findByUserId(9500);
    const cashOnly = await repository.findByUserId(9510);

    expect(zero?.quotes).toEqual([]);
    expect(calculatePortfolio(zero!)).toEqual({
      totalValue: '100.00',
      availableCash: '100.00',
      positions: [],
    });
    expect(cashOnly?.instruments).toEqual([]);
    expect(cashOnly?.quotes).toEqual([]);
    expect(calculatePortfolio(cashOnly!)).toEqual({
      totalValue: '1000.00',
      availableCash: '1000.00',
      positions: [],
    });
  });

  it('keeps the complete previous snapshot while a writer commits between reads', async () => {
    await pool!.query(
      `INSERT INTO users (id, email, accountnumber)
       VALUES (9600, 'b07b-concurrent@test.invalid', '9600')`,
    );
    await pool!.query(
      `INSERT INTO instruments (id, ticker, name, type)
       VALUES (9601, 'BCONC', 'B07B concurrency', 'ACCIONES')`,
    );
    await insertOrders([
      {
        id: 9601,
        instrumentId: 9601,
        userId: 9600,
        side: 'CASH_IN',
        status: 'FILLED',
        type: 'MARKET',
        size: 1_000,
        price: null,
        datetime: '2023-07-01 00:00:00.000000',
      },
      {
        id: 9602,
        instrumentId: 9601,
        userId: 9600,
        side: 'BUY',
        status: 'FILLED',
        type: 'MARKET',
        size: 10,
        price: '100.00',
        datetime: '2023-07-02 00:00:00.000000',
      },
    ]);
    await insertQuotes([
      {
        id: 9601,
        instrumentId: 9601,
        date: '2023-07-14',
        close: '100.00',
        previousClose: '90.00',
      },
    ]);

    const pausingPool = new PausingPortfolioPool(pool!);
    const concurrentRepository = new PostgresPortfolioSnapshotRepository(
      pausingPool,
    );
    const beforePromise = concurrentRepository.findByUserId(9600);

    await pausingPool.quoteGateReached;

    const writer = await pool!.connect();
    let writerFinished = false;

    try {
      await writer.query('BEGIN');
      await insertOrdersWithClient(writer, [
        {
          id: 9603,
          instrumentId: 9601,
          userId: 9600,
          side: 'SELL',
          status: 'FILLED',
          type: 'MARKET',
          size: 5,
          price: '150.00',
          datetime: '2023-07-15 00:00:00.000000',
        },
      ]);
      await insertQuotesWithClient(writer, [
        {
          id: 9602,
          instrumentId: 9601,
          date: '2023-07-15',
          close: '200.00',
          previousClose: '100.00',
        },
      ]);
      await writer.query('COMMIT');
      writerFinished = true;
    } finally {
      writer.release();
    }

    pausingPool.openQuoteGate();

    const previous = await beforePromise;
    const after = await repository.findByUserId(9600);

    expect(writerFinished).toBe(true);
    expect(previous?.movements.map(({ id }) => id)).toEqual([9601, 9602]);
    expect(previous?.quotes).toEqual([
      expect.objectContaining({
        id: 9601,
        close: '100.00',
        previousClose: '90.00',
      }),
    ]);
    expect(after?.movements.map(({ id }) => id)).toEqual([
      9601, 9602, 9603,
    ]);
    expect(after?.quotes).toEqual([
      expect.objectContaining({
        id: 9602,
        close: '200.00',
        previousClose: '100.00',
      }),
    ]);
  });
});

class PausingPortfolioPool implements PortfolioConnectionPool {
  private paused = false;
  private readonly gate: Promise<void>;
  private openGate: () => void = () => undefined;
  private readonly reached: Promise<void>;
  private markReached: () => void = () => undefined;

  constructor(private readonly pool: Pool) {
    this.gate = new Promise((resolve) => {
      this.openGate = resolve;
    });
    this.reached = new Promise((resolve) => {
      this.markReached = resolve;
    });
  }

  get quoteGateReached(): Promise<void> {
    return this.reached;
  }

  openQuoteGate(): void {
    this.openGate();
  }

  async connect(): Promise<PortfolioTransactionClient> {
    const client = await this.pool.connect();

    return {
      query: async <Row extends Record<string, unknown>>(
        text: string,
        values: unknown[],
      ) => {
        if (!this.paused && text.includes('FROM marketdata')) {
          this.paused = true;
          this.markReached();
          await this.gate;
        }

        return client.query<Row>(text, values);
      },
      release: (destroy?: boolean) => {
        client.release(destroy);
      },
    };
  }
}

async function insertOrders(orders: readonly OrderFixture[]): Promise<void> {
  await insertOrdersWithClient(pool!, orders);
}

async function insertOrdersWithClient(
  client: Pool | PoolClient,
  orders: readonly OrderFixture[],
): Promise<void> {
  for (const order of orders) {
    await client.query(
      `INSERT INTO orders
         (id, instrumentid, userid, side, status, type, size, price, datetime)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [
        order.id,
        order.instrumentId,
        order.userId,
        order.side,
        order.status,
        order.type ?? 'MARKET',
        order.size,
        order.price,
        order.datetime,
      ],
    );
  }
}

async function insertQuotes(quotes: readonly QuoteFixture[]): Promise<void> {
  await insertQuotesWithClient(pool!, quotes);
}

async function insertQuotesWithClient(
  client: Pool | PoolClient,
  quotes: readonly QuoteFixture[],
): Promise<void> {
  for (const quote of quotes) {
    await client.query(
      `INSERT INTO marketdata
         (id, instrumentid, date, close, previousclose)
       VALUES ($1, $2, $3, $4, $5)`,
      [
        quote.id,
        quote.instrumentId,
        quote.date,
        quote.close,
        quote.previousClose,
      ],
    );
  }
}
