import type { Instrument } from '../../instruments/domain/instrument.js';
import type { LatestQuote } from '../../quotes/domain/latest-quote.js';
import type { PortfolioMovement } from './portfolio-movement.js';

/**
 * Read-only view of one account used to calculate its portfolio.
 *
 * It represents a single consistent read, but this contract does not define
 * or prove how the adapter obtains that snapshot. In particular, SQL,
 * transactions and concurrency belong to B07-B.
 */
export interface PortfolioReadSnapshot {
  /**
   * Every movement relevant to accounting cash and NEW reservations. The
   * sequence is guaranteed to be ordered by `datetime` ascending and, only for
   * equal timestamps, by `id` ascending. Consumers must process it in that
   * order instead of sorting by id alone or converting timestamps to `Date`.
   */
  readonly movements: readonly PortfolioMovement[];
  /**
   * Metadata for the instruments that may be returned as positions. Ticker and
   * name are nullable, but an existing position without its metadata is
   * inconsistent.
   */
  readonly instruments: readonly Instrument[];
  /**
   * At most one latest quote row per instrument. Only the latest close and its
   * previous close from that same row are used; no older row is a fallback.
   */
  readonly quotes: readonly LatestQuote[];
}
