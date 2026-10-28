import type { Pool, PoolClient } from 'pg';
import type { PostgresConnectionPool } from '../../src/transactions/infrastructure/persistence/postgres-account-transaction.runner.js';

/**
 * Test-only wrapper that keeps the acquired client visible to fixture code.
 * Production code receives only the transaction runner and its bound ports.
 */
export class RecordingConnectionPool implements PostgresConnectionPool {
  private readonly acquired: PoolClient[] = [];

  constructor(private readonly pool: Pool) {}

  async connect(): Promise<PoolClient> {
    const client = await this.pool.connect();
    this.acquired.push(client);
    return client;
  }

  get latest(): PoolClient {
    const client = this.acquired.at(-1);

    if (client === undefined) {
      throw new Error('No PostgreSQL client has been acquired.');
    }

    return client;
  }
}
