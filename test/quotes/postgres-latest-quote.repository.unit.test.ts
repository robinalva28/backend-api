import { describe, expect, it, vi } from 'vitest';
import type { LatestQuote } from '../../src/quotes/domain/latest-quote.js';
import {
  PostgresLatestQuoteRepository,
  type PostgresQueryable,
} from '../../src/quotes/infrastructure/persistence/postgres-latest-quote.repository.js';

interface QueryCall {
  text: string;
  values: unknown[];
}

interface QuoteRow {
  id: number;
  instrument_id: number;
  date: string;
  close: string | null;
  previous_close: string | null;
}

function createQueryable(rows: QuoteRow[] = []): {
  queryable: PostgresQueryable;
  calls: QueryCall[];
} {
  const calls: QueryCall[] = [];
  const query = vi.fn(async (text: string, values: unknown[]) => {
    calls.push({ text, values });

    return {
      rows,
      command: 'SELECT',
      rowCount: rows.length,
      oid: 0,
      fields: [],
    };
  });

  return {
    queryable: { query } as PostgresQueryable,
    calls,
  };
}

describe('PostgresLatestQuoteRepository', () => {
  it('parameterizes by instrument and selects the latest non-null date with id tie-break', async () => {
    const { queryable, calls } = createQueryable();
    const repository = new PostgresLatestQuoteRepository(queryable);

    await repository.findLatestByInstrumentId(47);

    expect(calls).toHaveLength(1);
    expect(calls[0]?.text).toContain('FROM marketdata');
    expect(calls[0]?.text).toContain('instrumentid = $1');
    expect(calls[0]?.text).toContain('date IS NOT NULL');
    expect(calls[0]?.text).toContain(
      'ORDER BY marketdata.date DESC, marketdata.id DESC',
    );
    expect(calls[0]?.text).not.toContain('ORDER BY date DESC');
    expect(calls[0]?.text).toContain('LIMIT 1');
    expect(calls[0]?.text).not.toContain('47');
    expect(calls[0]?.text).not.toContain('close IS');
    expect(calls[0]?.text).not.toContain('previousclose IS');
    expect(calls[0]?.values).toEqual([47]);
  });

  it('maps the selected row to the internal model with exact decimal text and a calendar date', async () => {
    const { queryable } = createQueryable([
      {
        id: 3198,
        instrument_id: 47,
        date: '2023-07-14',
        close: '12345678.90',
        previous_close: '0.10',
      },
    ]);
    const repository = new PostgresLatestQuoteRepository(queryable);

    const quote: LatestQuote | null =
      await repository.findLatestByInstrumentId(47);

    expect(quote).toEqual({
      id: 3198,
      instrumentId: 47,
      date: '2023-07-14',
      close: '12345678.90',
      previousClose: '0.10',
    });
  });

  it('preserves null close and previousClose instead of substituting another value', async () => {
    const { queryable } = createQueryable([
      {
        id: 12,
        instrument_id: 54,
        date: '2023-07-14',
        close: null,
        previous_close: null,
      },
    ]);
    const repository = new PostgresLatestQuoteRepository(queryable);

    await expect(repository.findLatestByInstrumentId(54)).resolves.toEqual({
      id: 12,
      instrumentId: 54,
      date: '2023-07-14',
      close: null,
      previousClose: null,
    });
  });

  it('returns an internal absence when PostgreSQL returns no rows', async () => {
    const { queryable } = createQueryable();
    const repository = new PostgresLatestQuoteRepository(queryable);

    await expect(repository.findLatestByInstrumentId(3)).resolves.toBeNull();
  });

  it('propagates a PostgreSQL failure instead of reporting absence', async () => {
    const failure = new Error('driver failure');
    const query = vi.fn().mockRejectedValueOnce(failure);
    const repository = new PostgresLatestQuoteRepository({
      query,
    } as unknown as PostgresQueryable);

    await expect(repository.findLatestByInstrumentId(47)).rejects.toBe(failure);
  });
});
