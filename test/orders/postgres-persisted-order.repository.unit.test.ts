import { describe, expect, it, vi } from 'vitest';
import { PersistedOrderMappingError } from '../../src/orders/application/errors/persisted-order-mapping.error.js';
import {
  PostgresPersistedOrderRepository,
  type PostgresQueryable,
} from '../../src/orders/infrastructure/persistence/postgres-persisted-order.repository.js';

interface QueryCall {
  readonly text: string;
  readonly values: unknown[];
}

interface PersistedOrderRow {
  id: number | null;
  userid: number | null;
  status: string | null;
  idempotency_key: string | null;
  idempotency_metadata: unknown;
}

const KEY = '11111111-1111-4111-8111-111111111111';

function createQueryable(rows: PersistedOrderRow[] = []): {
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

function row(overrides: Partial<PersistedOrderRow> = {}): PersistedOrderRow {
  return {
    id: 9,
    userid: 4401,
    status: 'NEW',
    idempotency_key: KEY,
    idempotency_metadata: {
      version: 1,
      parameters: {
        instrumentId: 47,
        side: 'BUY',
        type: 'MARKET',
        mode: 'size',
        size: '10',
      },
    },
    ...overrides,
  };
}

describe('PostgresPersistedOrderRepository', () => {
  it('parameterizes by user and idempotency key without filtering status', async () => {
    const { queryable, calls } = createQueryable([row()]);
    const repository = new PostgresPersistedOrderRepository(queryable);

    await repository.findByUserIdAndIdempotencyKey(4401, KEY);

    expect(calls).toHaveLength(1);
    expect(calls[0]?.text).toContain('FROM orders');
    expect(calls[0]?.text).toContain('userid = $1');
    expect(calls[0]?.text).toContain('idempotency_key = $2::uuid');
    expect(calls[0]?.text).not.toMatch(/\bstatus\s*(=|<>|IN)\b/i);
    expect(calls[0]?.values).toEqual([4401, KEY]);
    expect(calls[0]?.text).not.toContain(KEY);
  });

  it('maps the persisted row to the internal model and preserves raw metadata', async () => {
    const metadata = { version: 1, parameters: {} };
    const { queryable } = createQueryable([row({ idempotency_metadata: metadata })]);
    const repository = new PostgresPersistedOrderRepository(queryable);

    await expect(
      repository.findByUserIdAndIdempotencyKey(4401, KEY),
    ).resolves.toEqual({
      id: 9,
      userId: 4401,
      idempotencyKey: KEY,
      status: 'NEW',
      intentMetadata: metadata,
    });
  });

  it.each(['NEW', 'FILLED', 'REJECTED', 'CANCELLED'] as const)(
    'maps the supported %s status',
    async (status) => {
      const { queryable } = createQueryable([row({ status })]);
      const repository = new PostgresPersistedOrderRepository(queryable);

      const order = await repository.findByUserIdAndIdempotencyKey(4401, KEY);

      expect(order?.status).toBe(status);
    },
  );

  it('returns null when the key does not exist for the account', async () => {
    const { queryable } = createQueryable();
    const repository = new PostgresPersistedOrderRepository(queryable);

    await expect(
      repository.findByUserIdAndIdempotencyKey(4401, KEY),
    ).resolves.toBeNull();
  });

  it('propagates a client failure instead of reporting absence', async () => {
    const failure = new Error('driver failure');
    const query = vi.fn().mockRejectedValueOnce(failure);
    const repository = new PostgresPersistedOrderRepository({
      query,
    } as unknown as PostgresQueryable);

    await expect(
      repository.findByUserIdAndIdempotencyKey(4401, KEY),
    ).rejects.toBe(failure);
  });

  it.each([
    ['id', { id: null }],
    ['id', { id: 0 }],
    ['userId', { userid: null }],
    ['userId', { userid: 0 }],
    ['idempotencyKey', { idempotency_key: null }],
    ['idempotencyKey', { idempotency_key: '' }],
    ['status', { status: null }],
    ['status', { status: 'PARTIAL' }],
  ] as const)('rejects an invalid stored %s field', async (field, overrides) => {
    const { queryable } = createQueryable([row(overrides)]);
    const repository = new PostgresPersistedOrderRepository(queryable);

    let caught: unknown;

    try {
      await repository.findByUserIdAndIdempotencyKey(4401, KEY);
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(PersistedOrderMappingError);
    expect(caught).toMatchObject({ field });
  });
});
