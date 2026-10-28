export type AccountTransactionStage =
  | 'connection'
  | 'begin'
  | 'lock'
  | 'work'
  | 'commit'
  | 'rollback'
  | 'release';

/**
 * `confirmed` means PostgreSQL returned COMMIT.
 * `rolled-back` means PostgreSQL returned ROLLBACK for the COMMIT statement;
 * the transaction is known to be rolled back.
 * `uncertain` means COMMIT failed or returned an unexpected command and its
 * outcome cannot be assumed. It never implies a safe rollback.
 */
export type AccountTransactionCommitOutcome =
  | 'not-attempted'
  | 'confirmed'
  | 'rolled-back'
  | 'uncertain';

export type AccountTransactionClientDisposition =
  | 'not-acquired'
  | 'released'
  | 'discarded'
  | 'unknown';

export interface AccountTransactionErrorOptions {
  readonly stage: AccountTransactionStage;
  readonly commitOutcome: AccountTransactionCommitOutcome;
  readonly clientDisposition: AccountTransactionClientDisposition;
  readonly cause: unknown;
  readonly rollbackError?: unknown;
  readonly commitCommand?: string;
}

export class AccountTransactionError extends Error {
  readonly stage: AccountTransactionStage;
  readonly commitOutcome: AccountTransactionCommitOutcome;
  clientDisposition: AccountTransactionClientDisposition;
  readonly rollbackError: unknown | undefined;
  readonly commitCommand: string | undefined;
  releaseError: unknown | undefined;

  constructor(options: AccountTransactionErrorOptions) {
    super(`Account transaction failed during ${options.stage}.`, {
      cause: options.cause,
    });
    this.name = 'AccountTransactionError';
    this.stage = options.stage;
    this.commitOutcome = options.commitOutcome;
    this.clientDisposition = options.clientDisposition;
    this.rollbackError = options.rollbackError;
    this.commitCommand = options.commitCommand;
    this.releaseError = undefined;
  }

  markReleaseFailed(error: unknown): void {
    this.releaseError = error;
    this.clientDisposition = 'unknown';
  }
}
