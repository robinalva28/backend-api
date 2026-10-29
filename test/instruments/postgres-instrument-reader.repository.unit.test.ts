import { describe, expect, it, vi } from 'vitest';
import {
  PostgresInstrumentReader,
  type PostgresQueryable,
} from '../../src/instruments/infrastructure/persistence/postgres-instrument-reader.repository.js';

interface QueryCall {
  readonly text: string;
  readonly values: unknown[];
}

interface InstrumentRow {
  id: number;
  type: string | null;
}

function createQueryable(rows: InstrumentRow[] = []): {
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

describe('PostgresInstrumentReader', () => {
  it('queries only the requested instrument id and maps its type', async () => {
    const { queryable, calls } = createQueryable([
      { id: 47, type: 'ACCIONES' },
    ]);
    const reader = new PostgresInstrumentReader(queryable);

    await expect(reader.findById(47)).resolves.toEqual({
      id: 47,
      type: 'ACCIONES',
    });
    expect(calls).toHaveLength(1);
    expect(calls[0]?.text).toContain('FROM instruments');
    expect(calls[0]?.text).toContain('WHERE id = $1');
    expect(calls[0]?.values).toEqual([47]);
  });

  it('returns null when the instrument does not exist', async () => {
    const { queryable } = createQueryable([]);
    const reader = new PostgresInstrumentReader(queryable);

    await expect(reader.findById(404)).resolves.toBeNull();
  });

  it('preserves a null stored type for the use case to decide', async () => {
    const { queryable } = createQueryable([{ id: 1, type: null }]);
    const reader = new PostgresInstrumentReader(queryable);

    await expect(reader.findById(1)).resolves.toEqual({ id: 1, type: null });
  });

  it('propagates a read failure instead of reporting a missing instrument', async () => {
    const failure = new Error('database unavailable');
    const query = vi.fn(async () => {
      throw failure;
    });
    const reader = new PostgresInstrumentReader({
      query,
    } as PostgresQueryable);

    await expect(reader.findById(47)).rejects.toBe(failure);
  });
});
