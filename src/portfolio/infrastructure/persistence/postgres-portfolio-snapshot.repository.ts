import type { QueryResult, QueryResultRow } from 'pg';
import type { PortfolioSnapshotRepository } from '../../application/ports/out/portfolio-snapshot.repository.js';
import type { Instrument } from '../../../instruments/domain/instrument.js';
import type { LatestQuote } from '../../../quotes/domain/latest-quote.js';
import type { OrderSide, OrderStatus } from '../../../resources/domain/account-movement.js';
import type { PortfolioMovement } from '../../domain/portfolio-movement.js';
import type { PortfolioReadSnapshot } from '../../domain/portfolio-read-snapshot.js';

export interface PortfolioTransactionClient {
  query<Row extends QueryResultRow>(
    text: string,
    values: unknown[],
  ): Promise<QueryResult<Row>>;
  release(destroy?: boolean): void;
}

export interface PortfolioConnectionPool {
  connect(): Promise<PortfolioTransactionClient>;
}

interface UserRow extends QueryResultRow {
  id: number;
}

interface MovementRow extends QueryResultRow {
  id: number;
  instrument_id: number;
  side: string | null;
  status: string | null;
  size: number | null;
  price: string | null;
  datetime: string | null;
  type: string | null;
}

interface InstrumentRow extends QueryResultRow {
  id: number;
  ticker: string | null;
  name: string | null;
}

interface QuoteRow extends QueryResultRow {
  id: number;
  instrument_id: number;
  date: string | null;
  close: string | null;
  previous_close: string | null;
}

const BEGIN_TRANSACTION_SQL =
  'BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY';
const COMMIT_SQL = 'COMMIT';
const ROLLBACK_SQL = 'ROLLBACK';

const ACCOUNT_EXISTS_SQL = `
  SELECT id
  FROM users
  WHERE id = $1
`;

/**
 * Reads every order movement because both accounting cash and NEW reservations
 * depend on more than FILLED executions. The timestamp is projected as text
 * with six fractional digits, while ordering uses the native TIMESTAMP column
 * and then id, never the formatted text.
 */
const PORTFOLIO_MOVEMENTS_SQL = `
  SELECT
    id,
    instrumentid AS instrument_id,
    side,
    status,
    size,
    price::text AS price,
    to_char(datetime, 'YYYY-MM-DD"T"HH24:MI:SS.US') AS datetime,
    type
  FROM orders
  WHERE userid = $1
  ORDER BY orders.datetime ASC, orders.id ASC
`;

const INSTRUMENTS_SQL = `
  SELECT
    id,
    ticker,
    name
  FROM instruments
  WHERE id = ANY($1::int[])
  ORDER BY id ASC
`;

/**
 * Selects one latest row per instrument before any price validation. A null
 * date never wins and an invalid close from the selected row is never replaced
 * by an older row. `DISTINCT ON` uses the native DATE column, preserving the
 * B03 regression for extended years.
 */
const LATEST_QUOTES_SQL = `
  SELECT DISTINCT ON (marketdata.instrumentid)
    id,
    instrumentid AS instrument_id,
    to_char(date, 'YYYY-MM-DD') AS date,
    close::text AS close,
    previousclose::text AS previous_close
  FROM marketdata
  WHERE instrumentid = ANY($1::int[])
    AND date IS NOT NULL
  ORDER BY marketdata.instrumentid ASC, marketdata.date DESC, marketdata.id DESC
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

const ORDER_TYPES: ReadonlySet<string> = new Set(['MARKET', 'LIMIT']);

export class InvalidPortfolioSnapshotRowError extends Error {
  constructor(column: string) {
    super(`Stored portfolio data has an invalid ${column}.`);
    this.name = 'InvalidPortfolioSnapshotRowError';
  }
}

/**
 * Reads one account portfolio from a single PostgreSQL client inside a
 * REPEATABLE READ, READ ONLY transaction. The first statement fixes the
 * snapshot, so a writer that commits between these reads cannot mix old
 * movements with new metadata or quotes. It never locks the user row and never
 * writes orders, reservations or any other data.
 */
export class PostgresPortfolioSnapshotRepository
  implements PortfolioSnapshotRepository
{
  constructor(private readonly pool: PortfolioConnectionPool) {}

  async findByUserId(userId: number): Promise<PortfolioReadSnapshot | null> {
    const client = await this.pool.connect();
    let transactionOpen = false;
    let discardClient = false;
    let pendingError: unknown;

    try {
      try {
        await client.query(BEGIN_TRANSACTION_SQL, []);
        transactionOpen = true;
      } catch (error) {
        discardClient = true;
        throw error;
      }

      const userResult = await client.query<UserRow>(ACCOUNT_EXISTS_SQL, [
        userId,
      ]);

      if (userResult.rows.length === 0) {
        await client.query(ROLLBACK_SQL, []);
        transactionOpen = false;

        return null;
      }

      const movementResult = await client.query<MovementRow>(
        PORTFOLIO_MOVEMENTS_SQL,
        [userId],
      );
      const movements = movementResult.rows.map(toPortfolioMovement);
      const instrumentIds = readPositionInstrumentIds(movements);
      const instruments =
        instrumentIds.length === 0
          ? []
          : await this.readInstruments(client, instrumentIds);
      const quotes =
        instrumentIds.length === 0
          ? []
          : await this.readLatestQuotes(client, instrumentIds);

      try {
        await client.query(COMMIT_SQL, []);
        transactionOpen = false;
      } catch (error) {
        // A failed COMMIT leaves the client state uncertain. Discard it even if
        // a subsequent ROLLBACK happens to succeed.
        discardClient = true;
        throw error;
      }

      return { movements, instruments, quotes };
    } catch (error) {
      pendingError = error;

      if (transactionOpen) {
        try {
          await client.query(ROLLBACK_SQL, []);
          transactionOpen = false;
        } catch {
          discardClient = true;
        }
      }

      throw error;
    } finally {
      try {
        if (discardClient) {
          client.release(true);
        } else {
          client.release();
        }
      } catch (releaseError) {
        if (pendingError === undefined) {
          throw releaseError;
        }
      }
    }
  }

  private async readInstruments(
    client: PortfolioTransactionClient,
    instrumentIds: readonly number[],
  ): Promise<readonly Instrument[]> {
    const result = await client.query<InstrumentRow>(INSTRUMENTS_SQL, [
      instrumentIds,
    ]);

    return result.rows.map(toInstrument);
  }

  private async readLatestQuotes(
    client: PortfolioTransactionClient,
    instrumentIds: readonly number[],
  ): Promise<readonly LatestQuote[]> {
    const result = await client.query<QuoteRow>(LATEST_QUOTES_SQL, [
      instrumentIds,
    ]);

    return result.rows.map(toLatestQuote);
  }
}

function readPositionInstrumentIds(
  movements: readonly PortfolioMovement[],
): number[] {
  const ids = new Set<number>();

  for (const movement of movements) {
    if (
      movement.status === 'FILLED' &&
      (movement.side === 'BUY' || movement.side === 'SELL')
    ) {
      ids.add(movement.instrumentId);
    }
  }

  return [...ids].sort((left, right) => left - right);
}

function toPortfolioMovement(row: MovementRow): PortfolioMovement {
  return {
    id: readPositiveInteger(row.id, 'order id'),
    instrumentId: readPositiveInteger(row.instrument_id, 'order instrument id'),
    side: readOrderSide(row.side),
    status: readOrderStatus(row.status),
    size: readNonNegativeInteger(row.size, 'order size'),
    price: readNullableString(row.price, 'order price'),
    type: readOrderType(row.type),
    datetime: readTimestampText(row.datetime),
  };
}

function toInstrument(row: InstrumentRow): Instrument {
  return {
    id: readPositiveInteger(row.id, 'instrument id'),
    ticker: readNullableString(row.ticker, 'instrument ticker'),
    name: readNullableString(row.name, 'instrument name'),
  };
}

function toLatestQuote(row: QuoteRow): LatestQuote {
  return {
    id: readPositiveInteger(row.id, 'quote id'),
    instrumentId: readPositiveInteger(row.instrument_id, 'quote instrument id'),
    date: readDateText(row.date),
    close: readNullableString(row.close, 'quote close'),
    previousClose: readNullableString(row.previous_close, 'quote previous close'),
  };
}

function readPositiveInteger(value: unknown, column: string): number {
  if (
    typeof value !== 'number' ||
    !Number.isSafeInteger(value) ||
    value <= 0
  ) {
    throw new InvalidPortfolioSnapshotRowError(column);
  }

  return value;
}

function readNonNegativeInteger(value: unknown, column: string): number {
  if (
    typeof value !== 'number' ||
    !Number.isSafeInteger(value) ||
    value < 0
  ) {
    throw new InvalidPortfolioSnapshotRowError(column);
  }

  return value;
}

function readNullableString(value: unknown, column: string): string | null {
  if (value === null) {
    return null;
  }

  if (typeof value !== 'string') {
    throw new InvalidPortfolioSnapshotRowError(column);
  }

  return value;
}

function readTimestampText(value: unknown): string {
  if (typeof value !== 'string' || value.length === 0) {
    throw new InvalidPortfolioSnapshotRowError('order datetime');
  }

  return value;
}

function readDateText(value: unknown): string {
  if (typeof value !== 'string' || value.length === 0) {
    throw new InvalidPortfolioSnapshotRowError('quote date');
  }

  return value;
}

function readOrderSide(value: unknown): OrderSide {
  if (typeof value !== 'string' || !ORDER_SIDES.has(value)) {
    throw new InvalidPortfolioSnapshotRowError('order side');
  }

  return value as OrderSide;
}

function readOrderStatus(value: unknown): OrderStatus {
  if (typeof value !== 'string' || !ORDER_STATUSES.has(value)) {
    throw new InvalidPortfolioSnapshotRowError('order status');
  }

  return value as OrderStatus;
}

function readOrderType(value: unknown): 'MARKET' | 'LIMIT' | null {
  if (value === null) {
    return null;
  }

  if (typeof value !== 'string' || !ORDER_TYPES.has(value)) {
    throw new InvalidPortfolioSnapshotRowError('order type');
  }

  return value as 'MARKET' | 'LIMIT';
}
