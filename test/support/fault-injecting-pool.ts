import type {
  Pool,
  PoolClient,
  QueryResult,
  QueryResultRow,
} from 'pg';
import type {
  PostgresConnectionPool,
  PostgresTransactionClient,
} from '../../src/transactions/infrastructure/persistence/postgres-account-transaction.runner.js';

export type CommitFault =
  | 'none'
  | 'lose-response-after-commit'
  | 'fail-before-commit';

export interface RecordedQuery {
  readonly text: string;
  readonly values: unknown[];
}

/**
 * Test-only pool wrapper. It can inject the loss of a COMMIT acknowledgement
 * after PostgreSQL has committed, fail a COMMIT before it is executed, fail the
 * first prepared-order insert with a chosen SQLSTATE, or refuse the next
 * recovery connection. Production code never sees these controls.
 */
export class FaultInjectingPool implements PostgresConnectionPool {
  commitFault: CommitFault = 'none';
  failFirstOrderInsertWith: string | undefined;
  failConnectionAfterFirst = false;
  afterCommitted: (() => Promise<void>) | undefined;
  readonly clients: FaultInjectingPoolClient[] = [];
  connectCalls = 0;

  constructor(private readonly pool: Pool) {}

  reset(): void {
    this.commitFault = 'none';
    this.failFirstOrderInsertWith = undefined;
    this.failConnectionAfterFirst = false;
    this.afterCommitted = undefined;
    this.clients.length = 0;
    this.connectCalls = 0;
  }

  async connect(): Promise<PostgresTransactionClient> {
    this.connectCalls += 1;

    if (this.failConnectionAfterFirst && this.connectCalls > 1) {
      throw new Error('simulated recovery connection failure');
    }

    const client = new FaultInjectingPoolClient(
      await this.pool.connect(),
      this,
    );
    this.clients.push(client);

    return client;
  }

  takeCommitFault(): CommitFault {
    const fault = this.commitFault;
    this.commitFault = 'none';

    return fault;
  }

  async runAfterCommitted(): Promise<void> {
    const callback = this.afterCommitted;
    this.afterCommitted = undefined;

    if (callback !== undefined) {
      await callback();
    }
  }

  takeInsertFailure(text: string): Error | undefined {
    if (
      this.failFirstOrderInsertWith === undefined ||
      !text.includes('INSERT INTO orders')
    ) {
      return undefined;
    }

    const code = this.failFirstOrderInsertWith;
    this.failFirstOrderInsertWith = undefined;

    return Object.assign(new Error('forced order insert failure'), { code });
  }
}

export class FaultInjectingPoolClient implements PostgresTransactionClient {
  readonly queries: RecordedQuery[] = [];

  constructor(
    private readonly inner: PoolClient,
    private readonly owner: FaultInjectingPool,
  ) {}

  async query<Row extends QueryResultRow>(
    text: string,
    values: unknown[],
  ): Promise<QueryResult<Row>> {
    this.queries.push({ text, values });

    const insertFailure = this.owner.takeInsertFailure(text);

    if (insertFailure !== undefined) {
      throw insertFailure;
    }

    if (text === 'COMMIT') {
      const fault = this.owner.takeCommitFault();

      if (fault === 'fail-before-commit') {
        throw new Error('simulated COMMIT failure before execution');
      }

      const result = await this.inner.query<Row>(text, values);

      if (fault === 'lose-response-after-commit') {
        await this.owner.runAfterCommitted();
        throw new Error('simulated lost COMMIT acknowledgement');
      }

      return result;
    }

    return this.inner.query<Row>(text, values);
  }

  release(destroy?: boolean): void {
    this.inner.release(destroy);
  }
}
