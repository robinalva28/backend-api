import type { Pool } from 'pg';
import { describe, expect, it, vi } from 'vitest';
import {
  PostgresInstrumentSearchRepository,
  toLiteralContainsPattern,
} from '../../src/instruments/infrastructure/persistence/postgres-instrument-search.repository.js';

interface QueryCall {
  text: string;
  values: unknown[] | undefined;
}

function createPool(rows: unknown[] = []): {
  pool: Pool;
  query: ReturnType<typeof vi.fn>;
  calls: QueryCall[];
} {
  const calls: QueryCall[] = [];
  const query = vi.fn(async (text: string, values?: unknown[]) => {
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
    pool: { query } as unknown as Pool,
    query,
    calls,
  };
}

describe('toLiteralContainsPattern', () => {
  it('escapes LIKE metacharacters exactly once', () => {
    expect(toLiteralContainsPattern('100%')).toBe('%100!%%');
    expect(toLiteralContainsPattern('A_B')).toBe('%A!_B%');
    expect(toLiteralContainsPattern('!')).toBe('%!!%');
    expect(toLiteralContainsPattern('!!')).toBe('%!!!!%');
    expect(toLiteralContainsPattern('100%_!')).toBe('%100!%!_!!%');
  });
});

describe('PostgresInstrumentSearchRepository', () => {
  it('keeps the pattern in parameters and maps only id, ticker and name', async () => {
    const { pool, calls } = createPool([
      {
        id: 7,
        ticker: null,
        name: 'Pampa Holding S.A.',
        type: 'ACCIONES',
      },
    ]);
    const repository = new PostgresInstrumentSearchRepository(pool);

    const rows = await repository.searchByText('100%_!');

    expect(rows).toEqual([
      { id: 7, ticker: null, name: 'Pampa Holding S.A.' },
    ]);
    expect(calls).toHaveLength(1);
    expect(calls[0]?.text).toContain('ILIKE $1');
    expect(calls[0]?.text).not.toContain('100%_!');
    expect(calls[0]?.text).not.toContain('marketdata');
    expect(calls[0]?.values).toEqual(['%100!%!_!!%']);
  });

  it('returns an empty collection when PostgreSQL returns no rows', async () => {
    const { pool } = createPool([]);
    const repository = new PostgresInstrumentSearchRepository(pool);

    await expect(repository.searchByText('missing')).resolves.toEqual([]);
  });

  it('preserves the row order and nulls from the driver', async () => {
    const { pool } = createPool([
      { id: 2, ticker: 'PAMP', name: null },
      { id: 1, ticker: null, name: 'Pampa' },
    ]);
    const repository = new PostgresInstrumentSearchRepository(pool);

    await expect(repository.searchByText('PAMP')).resolves.toEqual([
      { id: 2, ticker: 'PAMP', name: null },
      { id: 1, ticker: null, name: 'Pampa' },
    ]);
  });

  it('propagates a client failure without hiding it', async () => {
    const failure = new Error('driver failure');
    const query = vi.fn().mockRejectedValueOnce(failure);
    const repository = new PostgresInstrumentSearchRepository({
      query,
    } as unknown as Pool);

    await expect(repository.searchByText('PAMP')).rejects.toBe(failure);
  });
});
