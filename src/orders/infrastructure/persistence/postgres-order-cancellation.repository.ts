import type { QueryResult, QueryResultRow } from 'pg';
import { OrderCancellationMappingError } from '../../application/errors/order-cancellation-mapping.error.js';
import type { OrderCancellationRepository } from '../../application/ports/out/order-cancellation.repository.js';
import type { CancellableOrder } from '../../domain/cancellable-order.js';
import type { PersistedOrderStatus } from '../../domain/persisted-order.js';

export interface PostgresQueryable {
  query<Row extends QueryResultRow>(
    text: string,
    values: unknown[],
  ): Promise<QueryResult<Row>>;
}

interface CancellableOrderRow extends QueryResultRow {
  id: number | null;
  userid: number | null;
  status: string | null;
}

const FIND_BY_USER_AND_ID_SQL = `
  SELECT
    id,
    userid,
    status
  FROM orders
  WHERE userid = $1
    AND id = $2
`;

const CANCEL_NEW_SQL = `
  UPDATE orders
     SET status = 'CANCELLED'
   WHERE userid = $1
     AND id = $2
     AND status = 'NEW'
  RETURNING id
`;

const ORDER_STATUSES: ReadonlySet<string> = new Set([
  'NEW',
  'FILLED',
  'REJECTED',
  'CANCELLED',
]);

/**
 * Reads and conditionally updates orders through the client of the current
 * account transaction. It never runs its own transaction, deletes rows,
 * rewrites other columns or treats zero updated rows as success.
 */
export class PostgresOrderCancellationRepository
  implements OrderCancellationRepository
{
  constructor(private readonly queryable: PostgresQueryable) {}

  async findByUserIdAndId(
    userId: number,
    orderId: number,
  ): Promise<CancellableOrder | null> {
    const result = await this.queryable.query<CancellableOrderRow>(
      FIND_BY_USER_AND_ID_SQL,
      [userId, orderId],
    );
    const row = result.rows[0];

    if (row === undefined) {
      return null;
    }

    return mapCancellableOrder(row);
  }

  async markCancelledIfNew(
    userId: number,
    orderId: number,
  ): Promise<boolean> {
    const result = await this.queryable.query<{ id: number }>(
      CANCEL_NEW_SQL,
      [userId, orderId],
    );

    return result.rows.length === 1 && result.rows[0]?.id === orderId;
  }
}

function mapCancellableOrder(row: CancellableOrderRow): CancellableOrder {
  if (
    typeof row.id !== 'number' ||
    !Number.isSafeInteger(row.id) ||
    row.id <= 0
  ) {
    throw new OrderCancellationMappingError('id');
  }

  if (
    typeof row.userid !== 'number' ||
    !Number.isSafeInteger(row.userid) ||
    row.userid <= 0
  ) {
    throw new OrderCancellationMappingError('userId');
  }

  if (
    typeof row.status !== 'string' ||
    !ORDER_STATUSES.has(row.status)
  ) {
    throw new OrderCancellationMappingError('status');
  }

  return {
    id: row.id,
    userId: row.userid,
    status: row.status as PersistedOrderStatus,
  };
}
