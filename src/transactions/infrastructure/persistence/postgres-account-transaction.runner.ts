import type { QueryResult, QueryResultRow } from 'pg';
import { PostgresPersistedOrderRepository } from '../../../orders/infrastructure/persistence/postgres-persisted-order.repository.js';
import { PostgresPreparedOrderRepository } from '../../../orders/infrastructure/persistence/postgres-prepared-order.repository.js';
import { PostgresLatestQuoteRepository } from '../../../quotes/infrastructure/persistence/postgres-latest-quote.repository.js';
import { PostgresAccountMovementRepository } from '../../../resources/infrastructure/persistence/postgres-account-movement.repository.js';
import { AccountTransactionError } from '../../application/errors/account-transaction.error.js';
import type {
  AccountTransactionContext,
  AccountTransactionResult,
  AccountTransactionRunner,
} from '../../application/ports/out/account-transaction.port.js';

export interface PostgresTransactionClient {
  query<Row extends QueryResultRow>(
    text: string,
    values: unknown[],
  ): Promise<QueryResult<Row>>;
  release(destroy?: boolean): void;
}

export interface PostgresConnectionPool {
  connect(): Promise<PostgresTransactionClient>;
}

const BEGIN_TRANSACTION_SQL =
  'BEGIN TRANSACTION ISOLATION LEVEL READ COMMITTED';
const LOCK_ACCOUNT_SQL = 'SELECT id FROM users WHERE id = $1 FOR UPDATE';
const COMMIT_SQL = 'COMMIT';
const ROLLBACK_SQL = 'ROLLBACK';
const COMMIT_COMMAND = 'COMMIT';
const ROLLBACK_COMMAND = 'ROLLBACK';
const ROLLED_BACK_COMMIT_CAUSE =
  'PostgreSQL rolled back the transaction instead of committing it.';
const UNEXPECTED_COMMIT_COMMAND_CAUSE =
  'PostgreSQL returned an unexpected command for COMMIT.';

export class PostgresAccountTransactionRunner
  implements AccountTransactionRunner
{
  constructor(private readonly pool: PostgresConnectionPool) {}

  async run<T>(
    userId: number,
    work: (context: AccountTransactionContext) => Promise<T>,
  ): Promise<AccountTransactionResult<T>> {
    let client: PostgresTransactionClient;

    try {
      client = await this.pool.connect();
    } catch (error) {
      throw new AccountTransactionError({
        stage: 'connection',
        commitOutcome: 'not-attempted',
        clientDisposition: 'not-acquired',
        cause: error,
      });
    }

    let discardClient = false;
    let pendingError: AccountTransactionError | undefined;
    let commitConfirmed = false;

    try {
      try {
        await client.query(BEGIN_TRANSACTION_SQL, []);
      } catch (error) {
        discardClient = true;
        throw new AccountTransactionError({
          stage: 'begin',
          commitOutcome: 'not-attempted',
          clientDisposition: 'discarded',
          cause: error,
        });
      }

      let lockedAccount: readonly unknown[];
      try {
        const lockResult = await client.query<{ id: number }>(
          LOCK_ACCOUNT_SQL,
          [userId],
        );
        lockedAccount = lockResult.rows;
      } catch (error) {
        const rollbackError = await rollback(client);
        discardClient = rollbackError !== undefined;
        throw new AccountTransactionError({
          stage: 'lock',
          commitOutcome: 'not-attempted',
          clientDisposition: discardClient ? 'discarded' : 'released',
          cause: error,
          rollbackError,
        });
      }

      if (lockedAccount.length === 0) {
        const rollbackError = await rollback(client);

        if (rollbackError !== undefined) {
          discardClient = true;
          throw new AccountTransactionError({
            stage: 'rollback',
            commitOutcome: 'not-attempted',
            clientDisposition: 'discarded',
            cause: rollbackError,
            rollbackError,
          });
        }

        return { status: 'account-not-found' };
      }

      let value: T;

      try {
        const context = createContext(client, userId);
        value = await work(context);
      } catch (error) {
        const rollbackError = await rollback(client);
        discardClient = rollbackError !== undefined;
        throw new AccountTransactionError({
          stage: 'work',
          commitOutcome: 'not-attempted',
          clientDisposition: discardClient ? 'discarded' : 'released',
          cause: error,
          rollbackError,
        });
      }

      let commitResult: QueryResult<QueryResultRow>;

      try {
        commitResult = await client.query<QueryResultRow>(COMMIT_SQL, []);
      } catch (error) {
        const rollbackError = await rollback(client);
        discardClient = true;
        throw new AccountTransactionError({
          stage: 'commit',
          commitOutcome: 'uncertain',
          clientDisposition: 'discarded',
          cause: error,
          rollbackError,
        });
      }

      if (commitResult.command === COMMIT_COMMAND) {
        commitConfirmed = true;

        return { status: 'committed', value };
      }

      if (commitResult.command === ROLLBACK_COMMAND) {
        // PostgreSQL reports ROLLBACK for COMMIT when the transaction was aborted.
        throw new AccountTransactionError({
          stage: 'commit',
          commitOutcome: 'rolled-back',
          clientDisposition: 'released',
          commitCommand: commitResult.command,
          cause: new Error(ROLLED_BACK_COMMIT_CAUSE),
        });
      }

      const rollbackError = await rollback(client);
      discardClient = true;
      throw new AccountTransactionError({
        stage: 'commit',
        commitOutcome: 'uncertain',
        clientDisposition: 'discarded',
        commitCommand: commitResult.command,
        cause: new Error(UNEXPECTED_COMMIT_COMMAND_CAUSE),
        rollbackError,
      });
    } catch (error) {
      pendingError =
        error instanceof AccountTransactionError
          ? error
          : new AccountTransactionError({
              stage: 'work',
              commitOutcome: 'not-attempted',
              clientDisposition: discardClient ? 'discarded' : 'released',
              cause: error,
            });

      throw pendingError;
    } finally {
      try {
        if (discardClient) {
          client.release(true);
        } else {
          client.release();
        }
      } catch (releaseError) {
        if (pendingError !== undefined) {
          pendingError.markReleaseFailed(releaseError);
        } else {
          throw new AccountTransactionError({
            stage: 'release',
            commitOutcome: commitConfirmed ? 'confirmed' : 'not-attempted',
            clientDisposition: 'unknown',
            cause: releaseError,
          });
        }
      }
    }
  }
}

function createContext(
  client: PostgresTransactionClient,
  userId: number,
): AccountTransactionContext {
  return {
    userId,
    accountMovements: new PostgresAccountMovementRepository(client),
    latestQuotes: new PostgresLatestQuoteRepository(client),
    persistedOrders: new PostgresPersistedOrderRepository(client),
    preparedOrders: new PostgresPreparedOrderRepository(client, userId),
  };
}

async function rollback(
  client: PostgresTransactionClient,
): Promise<unknown | undefined> {
  try {
    await client.query(ROLLBACK_SQL, []);
    return undefined;
  } catch (error) {
    return error;
  }
}
