import type { QueryResult, QueryResultRow } from 'pg';
import type { AccountMovementRepository } from '../../application/ports/out/account-movement.repository.js';
import type {
  AccountMovement,
  OrderSide,
  OrderStatus,
} from '../../domain/account-movement.js';

export interface PostgresQueryable {
  query<Row extends QueryResultRow>(
    text: string,
    values: unknown[],
  ): Promise<QueryResult<Row>>;
}

interface AccountMovementRow extends QueryResultRow {
  id: number;
  instrument_id: number;
  side: string | null;
  status: string | null;
  size: number | null;
  price: string | null;
}

export class UnsupportedStoredOrderError extends Error {
  constructor(column: string) {
    super(`Stored order has an unsupported ${column}.`);
    this.name = 'UnsupportedStoredOrderError';
  }
}

const ACCOUNT_MOVEMENTS_SQL = `
  SELECT
    id,
    instrumentid AS instrument_id,
    side,
    status,
    size,
    price::text AS price
  FROM orders
  WHERE userid = $1
`;

const ORDER_SIDES: ReadonlySet<string> = new Set([
  'BUY',
  'SELL',
  'CASH_IN',
  'CASH_OUT',
]);

const ORDER_STATUSES: ReadonlySet<string> = new Set([
  'NEW',
  'FILLED',
  'REJECTED',
  'CANCELLED',
]);

export class PostgresAccountMovementRepository
  implements AccountMovementRepository
{
  constructor(private readonly queryable: PostgresQueryable) {}

  async findByUserId(userId: number): Promise<readonly AccountMovement[]> {
    const result = await this.queryable.query<AccountMovementRow>(
      ACCOUNT_MOVEMENTS_SQL,
      [userId],
    );

    return result.rows.map(toAccountMovement);
  }
}

function toAccountMovement(row: AccountMovementRow): AccountMovement {
  if (typeof row.size !== 'number' || !Number.isSafeInteger(row.size)) {
    throw new UnsupportedStoredOrderError('size');
  }

  return {
    id: row.id,
    instrumentId: row.instrument_id,
    side: readOrderSide(row.side),
    status: readOrderStatus(row.status),
    size: row.size,
    price: row.price,
  };
}

function readOrderSide(value: string | null): OrderSide {
  if (value === null || !ORDER_SIDES.has(value)) {
    throw new UnsupportedStoredOrderError('side');
  }

  return value as OrderSide;
}

function readOrderStatus(value: string | null): OrderStatus {
  if (value === null || !ORDER_STATUSES.has(value)) {
    throw new UnsupportedStoredOrderError('status');
  }

  return value as OrderStatus;
}
