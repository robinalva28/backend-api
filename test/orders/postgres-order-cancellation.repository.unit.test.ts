import { describe, expect, it, vi } from 'vitest';
import { OrderCancellationMappingError } from '../../src/orders/application/errors/order-cancellation-mapping.error.js';
import {
  PostgresOrderCancellationRepository,
  type PostgresQueryable,
} from '../../src/orders/infrastructure/persistence/postgres-order-cancellation.repository.js';

interface QueryCall {
  readonly text: string;
  readonly values: unknown[];
}

interface CancellableRow {
  id: number | null;
  userid: number | null;
  status: string | null;
}

interface QueryableFixture {
  readonly queryable: PostgresQueryable;
  readonly calls: QueryCall[];
}

const USER_ID = 5601;
const ORDER_ID = 901;

function createQueryable(
  options: {
    readonly rows?: readonly CancellableRow[];
    readonly updatedRows?: ReadonlyArray<{ id: number | null }>;
  } = {},
): QueryableFixture {
  const calls: QueryCall[] = [];
  const query = vi.fn(async (text: string, values: unknown[]) => {
    calls.push({ text, values });
    const rows = text.trimStart().startsWith('UPDATE')
      ? (options.updatedRows ?? [])
      : (options.rows ?? []);

    return {
      rows,
      command: text.trimStart().startsWith('UPDATE') ? 'UPDATE' : 'SELECT',
      rowCount: rows.length,
      oid: 0,
      fields: [],
    };
  });

  return {
    queryable: { query } as unknown as PostgresQueryable,
    calls,
  };
}

function row(overrides: Partial<CancellableRow> = {}): CancellableRow {
  return {
    id: ORDER_ID,
    userid: USER_ID,
    status: 'NEW',
    ...overrides,
  };
}

describe('PostgresOrderCancellationRepository', () => {
  it('reads by account and order without requiring idempotency identity', async () => {
    const { queryable, calls } = createQueryable({ rows: [row()] });
    const repository = new PostgresOrderCancellationRepository(queryable);

    await repository.findByUserIdAndId(USER_ID, ORDER_ID);

    expect(calls).toHaveLength(1);
    expect(calls[0]?.text).toContain('FROM orders');
    expect(calls[0]?.text).toContain('userid = $1');
    expect(calls[0]?.text).toContain('id = $2');
    expect(calls[0]?.values).toEqual([USER_ID, ORDER_ID]);
    expect(calls[0]?.text).not.toMatch(/idempotency/i);
    expect(calls[0]?.text).not.toMatch(/\bstatus\s*(=|<>|IN)\b/i);
    expect(calls[0]?.text).not.toContain(String(USER_ID));
    expect(calls[0]?.text).not.toContain(String(ORDER_ID));
  });

  it('maps the stored row to the minimal cancellable model', async () => {
    const { queryable } = createQueryable({ rows: [row()] });
    const repository = new PostgresOrderCancellationRepository(queryable);

    await expect(
      repository.findByUserIdAndId(USER_ID, ORDER_ID),
    ).resolves.toEqual({ id: ORDER_ID, userId: USER_ID, status: 'NEW' });
  });

  it.each(['NEW', 'FILLED', 'REJECTED', 'CANCELLED'] as const)(
    'maps the supported %s status',
    async (status) => {
      const { queryable } = createQueryable({ rows: [row({ status })] });
      const repository = new PostgresOrderCancellationRepository(queryable);

      const order = await repository.findByUserIdAndId(USER_ID, ORDER_ID);

      expect(order?.status).toBe(status);
    },
  );

  it('returns null when the account has no such order', async () => {
    const { queryable } = createQueryable();
    const repository = new PostgresOrderCancellationRepository(queryable);

    await expect(
      repository.findByUserIdAndId(USER_ID, ORDER_ID),
    ).resolves.toBeNull();
  });

  it.each([
    ['id', { id: null }],
    ['id', { id: 0 }],
    ['userId', { userid: null }],
    ['userId', { userid: -1 }],
    ['status', { status: null }],
    ['status', { status: 'PARTIAL' }],
  ] as const)('rejects an invalid stored %s field', async (field, overrides) => {
    const { queryable } = createQueryable({ rows: [row(overrides)] });
    const repository = new PostgresOrderCancellationRepository(queryable);

    await expect(
      repository.findByUserIdAndId(USER_ID, ORDER_ID),
    ).rejects.toMatchObject({
      name: 'OrderCancellationMappingError',
      field,
    });
    await expect(
      repository.findByUserIdAndId(USER_ID, ORDER_ID),
    ).rejects.toBeInstanceOf(OrderCancellationMappingError);
  });

  it('executes one conditional NEW to CANCELLED transition scoped by account and order', async () => {
    const { queryable, calls } = createQueryable({
      updatedRows: [{ id: ORDER_ID }],
    });
    const repository = new PostgresOrderCancellationRepository(queryable);

    await expect(
      repository.markCancelledIfNew(USER_ID, ORDER_ID),
    ).resolves.toBe(true);

    expect(calls).toHaveLength(1);
    const sql = calls[0]?.text ?? '';
    expect(sql).toContain('UPDATE orders');
    expect(sql).toContain("SET status = 'CANCELLED'");
    expect(sql).toContain('userid = $1');
    expect(sql).toContain('id = $2');
    expect(sql).toContain("status = 'NEW'");
    expect(sql).toContain('RETURNING id');
    expect(sql).not.toMatch(/DELETE|INSERT|idempotency|price|size|datetime/i);
    expect(calls[0]?.values).toEqual([USER_ID, ORDER_ID]);
    expect(sql).not.toContain(String(USER_ID));
    expect(sql).not.toContain(String(ORDER_ID));
  });

  it('does not acknowledge success when no row was transitioned', async () => {
    const { queryable } = createQueryable();
    const repository = new PostgresOrderCancellationRepository(queryable);

    await expect(
      repository.markCancelledIfNew(USER_ID, ORDER_ID),
    ).resolves.toBe(false);
  });

  it('does not acknowledge an unexpected returned order id', async () => {
    const { queryable } = createQueryable({
      updatedRows: [{ id: ORDER_ID + 1 }],
    });
    const repository = new PostgresOrderCancellationRepository(queryable);

    await expect(
      repository.markCancelledIfNew(USER_ID, ORDER_ID),
    ).resolves.toBe(false);
  });

  it('propagates read and update failures', async () => {
    const failure = new Error('driver failure');
    const query = vi.fn().mockRejectedValue(failure);
    const repository = new PostgresOrderCancellationRepository({
      query,
    } as unknown as PostgresQueryable);

    await expect(
      repository.findByUserIdAndId(USER_ID, ORDER_ID),
    ).rejects.toBe(failure);
    await expect(
      repository.markCancelledIfNew(USER_ID, ORDER_ID),
    ).rejects.toBe(failure);
  });
});
