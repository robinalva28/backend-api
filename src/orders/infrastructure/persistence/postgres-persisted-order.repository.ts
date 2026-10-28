import type { QueryResult, QueryResultRow } from 'pg';
import { PersistedOrderMappingError } from '../../application/errors/persisted-order-mapping.error.js';
import type { PersistedOrderRepository } from '../../application/ports/out/persisted-order.repository.js';
import type {
  PersistedOrder,
  PersistedOrderStatus,
} from '../../domain/persisted-order.js';

export interface PostgresQueryable {
  query<Row extends QueryResultRow>(
    text: string,
    values: unknown[],
  ): Promise<QueryResult<Row>>;
}

interface PersistedOrderRow extends QueryResultRow {
  id: number | null;
  userid: number | null;
  status: string | null;
  idempotency_key: string | null;
  idempotency_metadata: unknown;
}

const FIND_BY_KEY_SQL = `
  SELECT
    id,
    userid,
    status,
    idempotency_key::text AS idempotency_key,
    idempotency_metadata
  FROM orders
  WHERE userid = $1
    AND idempotency_key = $2::uuid
`;

const ORDER_STATUSES: ReadonlySet<string> = new Set([
  'NEW',
  'FILLED',
  'REJECTED',
  'CANCELLED',
]);

export class PostgresPersistedOrderRepository
  implements PersistedOrderRepository
{
  constructor(private readonly queryable: PostgresQueryable) {}

  async findByUserIdAndIdempotencyKey(
    userId: number,
    idempotencyKey: string,
  ): Promise<PersistedOrder | null> {
    const result = await this.queryable.query<PersistedOrderRow>(
      FIND_BY_KEY_SQL,
      [userId, idempotencyKey],
    );
    const row = result.rows[0];

    if (row === undefined) {
      return null;
    }

    return mapPersistedOrder(row);
  }
}

function mapPersistedOrder(row: PersistedOrderRow): PersistedOrder {
  if (
    typeof row.id !== 'number' ||
    !Number.isSafeInteger(row.id) ||
    row.id <= 0
  ) {
    throw new PersistedOrderMappingError('id');
  }

  if (
    typeof row.userid !== 'number' ||
    !Number.isSafeInteger(row.userid) ||
    row.userid <= 0
  ) {
    throw new PersistedOrderMappingError('userId');
  }

  if (
    typeof row.idempotency_key !== 'string' ||
    row.idempotency_key.length === 0
  ) {
    throw new PersistedOrderMappingError('idempotencyKey');
  }

  if (
    typeof row.status !== 'string' ||
    !ORDER_STATUSES.has(row.status)
  ) {
    throw new PersistedOrderMappingError('status');
  }

  return {
    id: row.id,
    userId: row.userid,
    idempotencyKey: row.idempotency_key,
    status: row.status as PersistedOrderStatus,
    intentMetadata: row.idempotency_metadata,
  };
}
