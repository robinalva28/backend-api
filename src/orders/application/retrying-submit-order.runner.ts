import { AccountTransactionError } from '../../transactions/application/errors/account-transaction.error.js';
import type {
  AccountTransactionContext,
  AccountTransactionResult,
  AccountTransactionRunner,
} from '../../transactions/application/ports/out/account-transaction.port.js';

const RETRY_DELAYS_MS = [50] as const;

export type SubmitOrderRetryDelay = (milliseconds: number) => Promise<void>;

function wait(milliseconds: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, milliseconds);
  });
}

/**
 * Submission-only transaction retry policy. It allows the initial attempt and
 * at most one retry after a single 50 ms wait. It repeats the complete runner
 * operation with the same user and work callback, including a fresh account
 * lock and all reads. The runner releases the client before its rejection
 * reaches this policy, so no lock or transaction remains open while waiting.
 * A second eligible failure is propagated without another attempt or wait.
 */
export class RetryingSubmitOrderRunner implements AccountTransactionRunner {
  constructor(
    private readonly runner: AccountTransactionRunner,
    private readonly delay: SubmitOrderRetryDelay = wait,
  ) {}

  async run<T>(
    userId: number,
    work: (context: AccountTransactionContext) => Promise<T>,
  ): Promise<AccountTransactionResult<T>> {
    for (let attempt = 0; ; attempt += 1) {
      try {
        return await this.runner.run(userId, work);
      } catch (error) {
        const delay = RETRY_DELAYS_MS[attempt];

        if (delay === undefined || !isEligibleTransientFailure(error)) {
          throw error;
        }

        await this.delay(delay);
      }
    }
  }
}

function isEligibleTransientFailure(
  error: unknown,
): error is AccountTransactionError {
  return (
    error instanceof AccountTransactionError &&
    error.transientFailure !== undefined &&
    error.commitOutcome === 'not-attempted' &&
    (error.stage === 'lock' || error.stage === 'work') &&
    error.rollbackError === undefined &&
    error.releaseError === undefined &&
    error.clientDisposition === 'released'
  );
}
