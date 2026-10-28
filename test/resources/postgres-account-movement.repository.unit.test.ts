import { describe, expect, it, vi } from 'vitest';
import type { AccountMovement } from '../../src/resources/domain/account-movement.js';
import {
  PostgresAccountMovementRepository,
  UnsupportedStoredOrderError,
  type PostgresQueryable,
} from '../../src/resources/infrastructure/persistence/postgres-account-movement.repository.js';

interface QueryCall {
  text: string;
  values: unknown[];
}

interface MovementRow {
  id: number;
  instrument_id: number;
  side: string | null;
  status: string | null;
  size: number | null;
  price: string | null;
}

function createQueryable(rows: MovementRow[] = []): {
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

describe('PostgresAccountMovementRepository', () => {
  it('parameterizes the query by user and does not interpolate the account id', async () => {
    const { queryable, calls } = createQueryable();
    const repository = new PostgresAccountMovementRepository(queryable);

    await repository.findByUserId(42);

    expect(calls).toHaveLength(1);
    expect(calls[0]?.text).toContain('FROM orders');
    expect(calls[0]?.text).toContain('userid = $1');
    expect(calls[0]?.text).not.toContain('42');
    expect(calls[0]?.values).toEqual([42]);
  });

  it('maps rows to the internal movement model and preserves exact decimal text', async () => {
    const { queryable } = createQueryable([
      {
        id: 10,
        instrument_id: 47,
        side: 'BUY',
        status: 'FILLED',
        size: 3,
        price: '1234567.89',
      },
      {
        id: 11,
        instrument_id: 66,
        side: 'CASH_OUT',
        status: 'FILLED',
        size: 100_000,
        price: null,
      },
      {
        id: 12,
        instrument_id: 31,
        side: 'SELL',
        status: 'NEW',
        size: 5,
        price: '0.10',
      },
    ]);
    const repository = new PostgresAccountMovementRepository(queryable);

    const movements: readonly AccountMovement[] =
      await repository.findByUserId(1);

    expect(movements).toEqual([
      {
        id: 10,
        instrumentId: 47,
        side: 'BUY',
        status: 'FILLED',
        size: 3,
        price: '1234567.89',
      },
      {
        id: 11,
        instrumentId: 66,
        side: 'CASH_OUT',
        status: 'FILLED',
        size: 100_000,
        price: null,
      },
      {
        id: 12,
        instrumentId: 31,
        side: 'SELL',
        status: 'NEW',
        size: 5,
        price: '0.10',
      },
    ]);
  });

  it('keeps every supported status available to the calculator', async () => {
    const statuses = ['NEW', 'FILLED', 'REJECTED', 'CANCELLED'] as const;
    const { queryable } = createQueryable(
      statuses.map((status, index) => ({
        id: index + 1,
        instrument_id: 47,
        side: 'BUY',
        status,
        size: 1,
        price: '10.00',
      })),
    );
    const repository = new PostgresAccountMovementRepository(queryable);

    const movements = await repository.findByUserId(1);

    expect(movements.map((movement) => movement.status)).toEqual(statuses);
  });

  it.each([
    {
      row: {
        id: 1,
        instrument_id: 47,
        side: 'HOLD',
        status: 'FILLED',
        size: 1,
        price: '10.00',
      },
      column: 'side',
    },
    {
      row: {
        id: 2,
        instrument_id: 47,
        side: 'BUY',
        status: 'PARTIAL',
        size: 1,
        price: '10.00',
      },
      column: 'status',
    },
    {
      row: {
        id: 3,
        instrument_id: 47,
        side: 'BUY',
        status: 'FILLED',
        size: null,
        price: '10.00',
      },
      column: 'size',
    },
  ])('rejects an unsupported stored $column value', async ({ row, column }) => {
    const { queryable } = createQueryable([row]);
    const repository = new PostgresAccountMovementRepository(queryable);

    await expect(repository.findByUserId(1)).rejects.toThrow(
      new UnsupportedStoredOrderError(column),
    );
  });

  it('propagates a client failure without hiding it', async () => {
    const failure = new Error('driver failure');
    const query = vi.fn().mockRejectedValueOnce(failure);
    const repository = new PostgresAccountMovementRepository({
      query,
    } as unknown as PostgresQueryable);

    await expect(repository.findByUserId(1)).rejects.toBe(failure);
  });
});
