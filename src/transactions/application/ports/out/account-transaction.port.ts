import type { LatestQuoteRepository } from '../../../../quotes/application/ports/out/latest-quote.repository.js';
import type { AccountMovementRepository } from '../../../../resources/application/ports/out/account-movement.repository.js';

/**
 * Capabilities bound to the single PostgreSQL client that owns the
 * transaction. The context is valid only while `work` is running.
 */
export interface AccountTransactionContext {
  readonly userId: number;
  readonly accountMovements: AccountMovementRepository;
  readonly latestQuotes: LatestQuoteRepository;
}

export type AccountTransactionResult<T> =
  | { readonly status: 'committed'; readonly value: T }
  | { readonly status: 'account-not-found' };

/**
 * Runs one attempt inside an account-scoped transaction. The account row is
 * locked before `work` is called and the lock is held until COMMIT/ROLLBACK.
 * A `committed` result is returned only after PostgreSQL confirms COMMIT; a
 * known ROLLBACK or an uncertain COMMIT raises `AccountTransactionError`.
 */
export interface AccountTransactionRunner {
  run<T>(
    userId: number,
    work: (context: AccountTransactionContext) => Promise<T>,
  ): Promise<AccountTransactionResult<T>>;
}
