import type { QueryResult, QueryResultRow } from 'pg';
import { describe, expect, it, vi } from 'vitest';
import {
  InvalidPortfolioSnapshotRowError,
  PostgresPortfolioSnapshotRepository,
  type PortfolioConnectionPool,
  type PortfolioTransactionClient,
} from '../../src/portfolio/infrastructure/persistence/postgres-portfolio-snapshot.repository.js';

interface QueryCall {
  readonly text: string;
  readonly values: unknown[];
}

interface QueryResultLike<Row extends QueryResultRow> {
  readonly rows: Row[];
}

type Handler = (
  text: string,
  values: unknown[],
  callIndex: number,
) => Promise<QueryResultLike<QueryResultRow>> | QueryResultLike<QueryResultRow>;

function queryResult<Row extends QueryResultRow>(
  rows: Row[],
): QueryResult<Row> {
  return {
    rows,
    command: 'SELECT',
    rowCount: rows.length,
    oid: 0,
    fields: [],
  };
}

function createHarness(handler: Handler): {
  readonly repository: PostgresPortfolioSnapshotRepository;
  readonly connect: ReturnType<typeof vi.fn>;
  readonly query: ReturnType<typeof vi.fn>;
  readonly release: ReturnType<typeof vi.fn>;
  readonly calls: QueryCall[];
} {
  const calls: QueryCall[] = [];
  const query = vi.fn(async (text: string, values: unknown[]) => {
    calls.push({ text, values });

    return handler(text, values, calls.length - 1);
  });
  const release = vi.fn();
  const client = {
    query,
    release,
  } as unknown as PortfolioTransactionClient;
  const connect = vi.fn(async () => client);
  const pool: PortfolioConnectionPool = { connect };

  return {
    repository: new PostgresPortfolioSnapshotRepository(pool),
    connect,
    query,
    release,
    calls,
  };
}

const USER_ROW = { id: 7 };
const MOVEMENT_ROW = {
  id: 101,
  instrument_id: 47,
  side: 'BUY',
  status: 'FILLED',
  size: 10,
  price: '123.45',
  datetime: '2023-07-12T12:31:20.123456',
  type: 'MARKET',
};
const INSTRUMENT_ROW = {
  id: 47,
  ticker: 'PAMP',
  name: 'Pampa Holding S.A.',
};
const QUOTE_ROW = {
  id: 65,
  instrument_id: 47,
  date: '2023-07-14',
  close: '925.85',
  previous_close: '921.80',
};

const BEGIN =
  'BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY';
const COMMIT = 'COMMIT';
const ROLLBACK = 'ROLLBACK';

describe('PostgresPortfolioSnapshotRepository', () => {
  it('uses one client, a read-only repeatable-read transaction and releases it after COMMIT', async () => {
    const harness = createHarness((text) => {
      if (text === BEGIN || text === COMMIT) {
        return queryResult([]);
      }

      if (text.includes('FROM users')) {
        return queryResult([USER_ROW]);
      }

      if (text.includes('FROM orders')) {
        return queryResult([MOVEMENT_ROW]);
      }

      if (text.includes('FROM instruments')) {
        return queryResult([INSTRUMENT_ROW]);
      }

      if (text.includes('FROM marketdata')) {
        return queryResult([QUOTE_ROW]);
      }

      throw new Error(`Unexpected SQL: ${text}`);
    });

    await expect(
      harness.repository.findByUserId(7),
    ).resolves.toEqual({
      movements: [
        {
          id: 101,
          instrumentId: 47,
          side: 'BUY',
          status: 'FILLED',
          size: 10,
          price: '123.45',
          type: 'MARKET',
          datetime: '2023-07-12T12:31:20.123456',
        },
      ],
      instruments: [INSTRUMENT_ROW],
      quotes: [
        {
          id: 65,
          instrumentId: 47,
          date: '2023-07-14',
          close: '925.85',
          previousClose: '921.80',
        },
      ],
    });

    expect(harness.connect).toHaveBeenCalledTimes(1);
    expect(harness.calls.map(({ text }) => text)).toEqual([
      BEGIN,
      expect.stringContaining('FROM users'),
      expect.stringContaining('FROM orders'),
      expect.stringContaining('FROM instruments'),
      expect.stringContaining('FROM marketdata'),
      COMMIT,
    ]);
    expect(harness.calls[0]?.values).toEqual([]);
    expect(harness.calls[1]?.values).toEqual([7]);
    expect(harness.calls[2]?.values).toEqual([7]);
    expect(harness.calls[3]?.values).toEqual([[47]]);
    expect(harness.calls[4]?.values).toEqual([[47]]);
    expect(harness.release).toHaveBeenCalledTimes(1);
    expect(harness.release).toHaveBeenCalledWith();
  });

  it('parameterizes every account and instrument value and never reads idempotency metadata', async () => {
    const harness = createHarness((text) => {
      if (text === BEGIN || text === COMMIT) {
        return queryResult([]);
      }

      if (text.includes('FROM users')) {
        return queryResult([{ id: 42 }]);
      }

      if (text.includes('FROM orders')) {
        return queryResult([{ ...MOVEMENT_ROW, id: 1, instrument_id: 47 }]);
      }

      if (text.includes('FROM instruments')) {
        return queryResult([INSTRUMENT_ROW]);
      }

      if (text.includes('FROM marketdata')) {
        return queryResult([QUOTE_ROW]);
      }

      throw new Error(`Unexpected SQL: ${text}`);
    });

    await harness.repository.findByUserId(42);

    const sql = harness.calls.map(({ text }) => text).join('\n');

    expect(sql).not.toContain('42');
    expect(sql).not.toContain('idempotency');
    expect(sql).toContain('userid = $1');
    expect(sql).not.toContain('FOR UPDATE');
    expect(sql).not.toContain("status = 'FILLED'");
    expect(sql).toContain('ORDER BY orders.datetime ASC, orders.id ASC');
    expect(sql).toContain(
      'ORDER BY marketdata.instrumentid ASC, marketdata.date DESC, marketdata.id DESC',
    );
    expect(sql).toContain('AND date IS NOT NULL');
    expect(sql).not.toContain('close IS NOT NULL');
  });

  it('returns null for a missing user without reading movements and rolls back', async () => {
    const harness = createHarness((text) => {
      if (text === BEGIN || text === ROLLBACK) {
        return queryResult([]);
      }

      if (text.includes('FROM users')) {
        return queryResult([]);
      }

      throw new Error(`Unexpected SQL: ${text}`);
    });

    await expect(harness.repository.findByUserId(999)).resolves.toBeNull();

    expect(harness.calls.map(({ text }) => text)).toEqual([
      BEGIN,
      expect.stringContaining('FROM users'),
      ROLLBACK,
    ]);
    expect(harness.release).toHaveBeenCalledWith();
  });

  it('does not query instruments or quotes for an account with only cash', async () => {
    const harness = createHarness((text) => {
      if (text === BEGIN || text === COMMIT) {
        return queryResult([]);
      }

      if (text.includes('FROM users')) {
        return queryResult([{ id: 3 }]);
      }

      if (text.includes('FROM orders')) {
        return queryResult([
          {
            id: 1,
            instrument_id: 66,
            side: 'CASH_IN',
            status: 'FILLED',
            size: 1_000,
            price: null,
            datetime: '2023-07-12T12:11:20.000000',
            type: 'MARKET',
          },
        ]);
      }

      throw new Error(`Unexpected SQL: ${text}`);
    });

    await expect(harness.repository.findByUserId(3)).resolves.toEqual({
      movements: [expect.objectContaining({ side: 'CASH_IN' })],
      instruments: [],
      quotes: [],
    });

    expect(
      harness.calls.some(({ text }) => text.includes('FROM instruments')),
    ).toBe(false);
    expect(
      harness.calls.some(({ text }) => text.includes('FROM marketdata')),
    ).toBe(false);
  });

  it('preserves nullable close and previousClose from the selected quote row', async () => {
    const harness = createHarness((text) => {
      if (text === BEGIN || text === COMMIT) {
        return queryResult([]);
      }

      if (text.includes('FROM users')) {
        return queryResult([USER_ROW]);
      }

      if (text.includes('FROM orders')) {
        return queryResult([MOVEMENT_ROW]);
      }

      if (text.includes('FROM instruments')) {
        return queryResult([INSTRUMENT_ROW]);
      }

      if (text.includes('FROM marketdata')) {
        return queryResult([
          { ...QUOTE_ROW, close: null, previous_close: null },
        ]);
      }

      throw new Error(`Unexpected SQL: ${text}`);
    });

    await expect(
      harness.repository.findByUserId(7),
    ).resolves.toMatchObject({
      quotes: [{ close: null, previousClose: null }],
    });
  });

  it('propagates a connection failure without trying to release a client', async () => {
    const connect = vi.fn(async () => {
      throw new Error('connection refused');
    });
    const repository = new PostgresPortfolioSnapshotRepository({ connect });

    await expect(repository.findByUserId(1)).rejects.toThrow(
      'connection refused',
    );
    expect(connect).toHaveBeenCalledTimes(1);
  });

  it('discards the client when BEGIN fails', async () => {
    const harness = createHarness((text) => {
      if (text === BEGIN) {
        throw new Error('begin failed');
      }

      throw new Error(`Unexpected SQL: ${text}`);
    });

    await expect(
      harness.repository.findByUserId(1),
    ).rejects.toThrow('begin failed');
    expect(harness.release).toHaveBeenCalledWith(true);
  });

  it.each([
    ['movements', 'FROM orders'],
    ['instruments', 'FROM instruments'],
    ['quotes', 'FROM marketdata'],
  ])('rolls back and releases after a %s query failure', async (_label, marker) => {
    const harness = createHarness((text) => {
      if (text === BEGIN) {
        return queryResult([]);
      }

      if (text === ROLLBACK) {
        return queryResult([]);
      }

      if (text.includes('FROM users')) {
        return queryResult([USER_ROW]);
      }

      if (text.includes('FROM orders')) {
        if (marker === 'FROM orders') {
          throw new Error('query failed');
        }

        return queryResult([MOVEMENT_ROW]);
      }

      if (text.includes('FROM instruments')) {
        if (marker === 'FROM instruments') {
          throw new Error('query failed');
        }

        return queryResult([INSTRUMENT_ROW]);
      }

      if (text.includes('FROM marketdata')) {
        throw new Error('query failed');
      }

      throw new Error(`Unexpected SQL: ${text}`);
    });

    await expect(
      harness.repository.findByUserId(7),
    ).rejects.toThrow('query failed');
    expect(harness.calls.at(-1)?.text).toBe(ROLLBACK);
    expect(harness.release).toHaveBeenCalledWith();
  });

  it.each([
    ['id', { ...MOVEMENT_ROW, id: '101' }],
    ['instrument id', { ...MOVEMENT_ROW, instrument_id: 0 }],
    ['size', { ...MOVEMENT_ROW, size: 1.5 }],
    ['side', { ...MOVEMENT_ROW, side: 'HOLD' }],
    ['status', { ...MOVEMENT_ROW, status: 'PENDING' }],
    ['type', { ...MOVEMENT_ROW, type: 'STOP' }],
    ['datetime', { ...MOVEMENT_ROW, datetime: null }],
    ['price', { ...MOVEMENT_ROW, price: 123 }],
  ])('rejects an invalid movement %s and cleans up', async (_label, row) => {
    const harness = createHarness((text) => {
      if (text === BEGIN || text === ROLLBACK) {
        return queryResult([]);
      }

      if (text.includes('FROM users')) {
        return queryResult([USER_ROW]);
      }

      if (text.includes('FROM orders')) {
        return queryResult([row]);
      }

      throw new Error(`Unexpected SQL: ${text}`);
    });

    await expect(
      harness.repository.findByUserId(7),
    ).rejects.toBeInstanceOf(InvalidPortfolioSnapshotRowError);
    expect(harness.calls.at(-1)?.text).toBe(ROLLBACK);
    expect(harness.release).toHaveBeenCalledWith();
  });

  it('discards the client when ROLLBACK also fails', async () => {
    const harness = createHarness((text) => {
      if (text === BEGIN) {
        return queryResult([]);
      }

      if (text === ROLLBACK) {
        throw new Error('rollback failed');
      }

      if (text.includes('FROM users')) {
        throw new Error('query failed');
      }

      throw new Error(`Unexpected SQL: ${text}`);
    });

    await expect(
      harness.repository.findByUserId(7),
    ).rejects.toThrow('query failed');
    expect(harness.release).toHaveBeenCalledWith(true);
  });

  it('discards the client when COMMIT fails', async () => {
    const harness = createHarness((text) => {
      if (text === BEGIN) {
        return queryResult([]);
      }

      if (text === COMMIT) {
        throw new Error('commit failed');
      }

      if (text === ROLLBACK) {
        return queryResult([]);
      }

      if (text.includes('FROM users')) {
        return queryResult([USER_ROW]);
      }

      if (text.includes('FROM orders')) {
        return queryResult([]);
      }

      throw new Error(`Unexpected SQL: ${text}`);
    });

    await expect(
      harness.repository.findByUserId(7),
    ).rejects.toThrow('commit failed');
    expect(harness.calls.at(-1)?.text).toBe(ROLLBACK);
    expect(harness.release).toHaveBeenCalledWith(true);
  });

  it('propagates a release failure after a successful read', async () => {
    const harness = createHarness((text) => {
      if (text === BEGIN || text === COMMIT) {
        return queryResult([]);
      }

      if (text.includes('FROM users')) {
        return queryResult([USER_ROW]);
      }

      if (text.includes('FROM orders')) {
        return queryResult([]);
      }

      throw new Error(`Unexpected SQL: ${text}`);
    });
    harness.release.mockImplementationOnce(() => {
      throw new Error('release failed');
    });

    await expect(
      harness.repository.findByUserId(7),
    ).rejects.toThrow('release failed');
  });
});
