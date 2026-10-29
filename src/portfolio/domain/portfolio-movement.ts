import type { AccountMovement } from '../../resources/domain/account-movement.js';

export type PortfolioOrderType = 'MARKET' | 'LIMIT' | null;

export interface PortfolioMovement extends AccountMovement {
  /**
   * Order type as read from persistence. FILLED BUY/SELL executions participate
   * in cost and quantity regardless of being MARKET or LIMIT.
   */
  readonly type: PortfolioOrderType;
  /**
   * Timestamp text exactly as read from the database. It must retain its full
   * precision, including microseconds, instead of passing through a JavaScript
   * `Date`. Snapshot movements are ordered by this value ascending and, only
   * when it is equal, by `id` ascending.
   */
  readonly datetime: string;
}
