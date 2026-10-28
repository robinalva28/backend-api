import type { QueryResult, QueryResultRow } from 'pg';
import { PreparedOrderPersistenceError } from '../../application/errors/prepared-order-persistence.error.js';
import type { PreparedOrderRepository } from '../../application/ports/out/prepared-order.repository.js';
import { buildOrderIntentMetadata } from '../../domain/order-intent-metadata.js';
import type { PersistedOrder } from '../../domain/persisted-order.js';
import type { PreparedOrder } from '../../domain/prepared-order.js';
import { createPreparedOrder } from '../../domain/prepared-order.js';

export interface PostgresQueryable {
  query<Row extends QueryResultRow>(
    text: string,
    values: unknown[],
  ): Promise<QueryResult<Row>>;
}

interface InsertedOrderRow extends QueryResultRow {
  id: number | null;
}

const INSERT_PREPARED_ORDER_SQL = `
  INSERT INTO orders (
    instrumentid,
    userid,
    size,
    price,
    type,
    side,
    status,
    datetime,
    idempotency_key,
    idempotency_metadata
  ) VALUES (
    $1,
    $2,
    $3,
    $4,
    $5,
    $6,
    $7,
    $8::timestamp,
    $9::uuid,
    $10::jsonb
  )
  RETURNING id
`;

/**
 * Inserts a prepared order through the client of the current account
 * transaction. It never runs COMMIT/ROLLBACK, never uses ON CONFLICT and never
 * updates an existing row.
 */
export class PostgresPreparedOrderRepository
  implements PreparedOrderRepository
{
  constructor(
    private readonly queryable: PostgresQueryable,
    private readonly userId: number,
  ) {}

  async insert(preparedOrder: PreparedOrder): Promise<PersistedOrder> {
    const order = createPreparedOrder(preparedOrder);
    const metadata = buildOrderIntentMetadata(order.intent);
    let result: QueryResult<InsertedOrderRow>;

    try {
      result = await this.queryable.query<InsertedOrderRow>(
        INSERT_PREPARED_ORDER_SQL,
        [
          order.intent.instrumentId,
          this.userId,
          order.size,
          order.price,
          order.intent.type,
          order.intent.side,
          order.status,
          order.datetime,
          order.idempotencyKey,
          JSON.stringify(metadata),
        ],
      );
    } catch (error) {
      throw new PreparedOrderPersistenceError(error);
    }

    const id = result.rows[0]?.id;

    if (typeof id !== 'number' || !Number.isSafeInteger(id) || id <= 0) {
      throw new PreparedOrderPersistenceError(
        new Error('The insert did not return a valid order id.'),
      );
    }

    return {
      id,
      userId: this.userId,
      idempotencyKey: order.idempotencyKey,
      status: order.status,
      intentMetadata: metadata,
    };
  }
}
