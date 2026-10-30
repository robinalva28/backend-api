import type { QueryResult, QueryResultRow } from 'pg';
import { describe, expect, it, vi } from 'vitest';
import { AccountTransactionError } from '../../src/transactions/application/errors/account-transaction.error.js';
import { RecordingLogger } from '../support/recording-logger.js';
import {
  PostgresAccountTransactionRunner,
  type PostgresConnectionPool,
  type PostgresTransactionClient,
} from '../../src/transactions/infrastructure/persistence/postgres-account-transaction.runner.js';

interface QueryCall {
  readonly text: string;
  readonly values: unknown[];
}

interface FakeClientOptions {
  readonly lockRows?: readonly { id: number }[];
  readonly beginError?: unknown;
  readonly lockError?: unknown;
  readonly commitError?: unknown;
  readonly commitCommand?: string;
  readonly rollbackError?: unknown;
  readonly releaseError?: unknown;
  readonly onQuery?: (text: string, values: unknown[]) => void;
}

class FakePostgresClient implements PostgresTransactionClient {
  readonly calls: QueryCall[] = [];
  readonly releases: Array<boolean | undefined> = [];

  constructor(private readonly options: FakeClientOptions = {}) {}

  async query<Row extends QueryResultRow>(
    text: string,
    values: unknown[],
  ): Promise<QueryResult<Row>> {
    this.calls.push({ text, values });
    this.options.onQuery?.(text, values);

    if (isBegin(text)) {
      if (this.options.beginError !== undefined) {
        throw this.options.beginError;
      }

      return result<Row>([], 'BEGIN');
    }

    if (isLockAccount(text)) {
      if (this.options.lockError !== undefined) {
        throw this.options.lockError;
      }

      return result<Row>(
        [...(this.options.lockRows ?? [])] as unknown as Row[],
        'SELECT',
      );
    }

    if (text === 'COMMIT') {
      if (this.options.commitError !== undefined) {
        throw this.options.commitError;
      }

      return result<Row>([], this.options.commitCommand ?? 'COMMIT');
    }

    if (text === 'ROLLBACK') {
      if (this.options.rollbackError !== undefined) {
        throw this.options.rollbackError;
      }

      return result<Row>([], 'ROLLBACK');
    }

    return result<Row>([], 'SELECT');
  }

  release(destroy?: boolean): void {
    this.releases.push(destroy);

    if (this.options.releaseError !== undefined) {
      throw this.options.releaseError;
    }
  }
}

function result<Row extends QueryResultRow>(
  rows: Row[],
  command: string,
): QueryResult<Row> {
  return {
    rows,
    command,
    rowCount: rows.length,
    oid: 0,
    fields: [],
  };
}

function isBegin(text: string): boolean {
  return text.startsWith('BEGIN TRANSACTION');
}

function isLockAccount(text: string): boolean {
  return text.includes('FROM users') && text.includes('FOR UPDATE');
}

function createPool(
  clients: readonly PostgresTransactionClient[],
): PostgresConnectionPool & { readonly connect: ReturnType<typeof vi.fn> } {
  const connect = vi.fn();

  for (const client of clients) {
    connect.mockResolvedValueOnce(client);
  }

  return { connect };
}

function transactionQueryCalls(client: FakePostgresClient): readonly QueryCall[] {
  return client.calls.filter(
    ({ text }) =>
      isBegin(text) ||
      isLockAccount(text) ||
      text === 'COMMIT' ||
      text === 'ROLLBACK',
  );
}

describe('PostgresAccountTransactionRunner', () => {
  it('runs BEGIN READ COMMITTED, the separate account lock, work and COMMIT on one client', async () => {
    const events: string[] = [];
    const client = new FakePostgresClient({
      lockRows: [{ id: 7 }],
      onQuery: (text) => events.push(queryLabel(text)),
    });
    const originalRelease = client.release.bind(client);
    client.release = (destroy?: boolean): void => {
      events.push('release');
      originalRelease(destroy);
    };
    const pool = {
      connect: async (): Promise<PostgresTransactionClient> => {
        events.push('connect');
        return client;
      },
    };
    const runner = new PostgresAccountTransactionRunner(pool);

    const result = await runner.run(7, async (context) => {
      events.push('work');
      expect(context.userId).toBe(7);
      return 'committed-value';
    });

    expect(result).toEqual({
      status: 'committed',
      value: 'committed-value',
    });
    expect(events).toEqual([
      'connect',
      'begin',
      'lock',
      'work',
      'commit',
      'release',
    ]);
    expect(transactionQueryCalls(client)).toEqual([
      { text: expect.stringMatching(/^BEGIN TRANSACTION/), values: [] },
      { text: LOCK_SQL, values: [7] },
      { text: 'COMMIT', values: [] },
    ]);
    expect(client.calls[0]?.text).toBe(
      'BEGIN TRANSACTION ISOLATION LEVEL READ COMMITTED',
    );
    expect(client.calls[1]?.text).toBe(
      'SELECT id FROM users WHERE id = $1 FOR UPDATE',
    );
    expect(client.calls.some(({ text }) => text === 'ROLLBACK')).toBe(false);
    expect(
      client.calls.some(({ text }) => text.includes('FROM marketdata')),
    ).toBe(false);
    expect(client.releases).toEqual([undefined]);
  });

  it('builds independent contexts and repositories bound to each execution client', async () => {
    const firstClient = new FakePostgresClient({ lockRows: [{ id: 1 }] });
    const secondClient = new FakePostgresClient({ lockRows: [{ id: 2 }] });
    const runner = new PostgresAccountTransactionRunner({
      connect: vi
        .fn()
        .mockResolvedValueOnce(firstClient)
        .mockResolvedValueOnce(secondClient),
    });
    let firstContext: unknown;
    let secondContext: unknown;

    await runner.run(1, async (context) => {
      firstContext = context;
      await context.instruments.findById(33);
      await context.accountMovements.findByUserId(1);
      await context.latestQuotes.findLatestByInstrumentId(11);
      return 'first';
    });
    await runner.run(2, async (context) => {
      secondContext = context;
      await context.accountMovements.findByUserId(2);
      await context.latestQuotes.findLatestByInstrumentId(22);
      return 'second';
    });

    expect(firstContext).not.toBe(secondContext);
    expect(firstClient.calls.some(({ text }) => text.includes('FROM orders'))).toBe(
      true,
    );
    expect(
      firstClient.calls.some(({ text }) => text.includes('FROM instruments')),
    ).toBe(true);
    expect(
      firstClient.calls.some(({ text }) => text.includes('FROM marketdata')),
    ).toBe(true);
    expect(secondClient.calls.some(({ text }) => text.includes('FROM orders'))).toBe(
      true,
    );
    expect(
      secondClient.calls.some(({ text }) => text.includes('FROM marketdata')),
    ).toBe(true);
    expect(
      firstClient.calls.filter(({ text }) => text.includes('FROM orders')),
    ).toHaveLength(1);
    expect(
      secondClient.calls.filter(({ text }) => text.includes('FROM orders')),
    ).toHaveLength(1);
  });

  it('does not acquire a client or call work when the pool rejects the connection', async () => {
    const failure = new Error('pool exhausted');
    const work = vi.fn();
    const runner = new PostgresAccountTransactionRunner({
      connect: vi.fn().mockRejectedValue(failure),
    });

    let caught: unknown;

    try {
      await runner.run(7, work);
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(AccountTransactionError);
    expect(caught).toMatchObject({
      stage: 'connection',
      commitOutcome: 'not-attempted',
      clientDisposition: 'not-acquired',
      cause: failure,
    });
    expect(work).not.toHaveBeenCalled();
  });

  it('does not call work and discards the client when BEGIN fails', async () => {
    const failure = new Error('begin failed');
    const client = new FakePostgresClient({ beginError: failure });
    const work = vi.fn();
    const runner = new PostgresAccountTransactionRunner(createPool([client]));

    let caught: unknown;

    try {
      await runner.run(7, work);
    } catch (error) {
      caught = error;
    }

    expect(caught).toMatchObject({
      stage: 'begin',
      commitOutcome: 'not-attempted',
      clientDisposition: 'discarded',
      cause: failure,
    });
    expect(work).not.toHaveBeenCalled();
    expect(transactionQueryCalls(client)).toHaveLength(1);
    expect(client.releases).toEqual([true]);
  });

  it('rolls back, preserves the cause and does not call work when the lock fails', async () => {
    const failure = new Error('lock failed');
    const client = new FakePostgresClient({ lockError: failure });
    const work = vi.fn();
    const runner = new PostgresAccountTransactionRunner(createPool([client]));

    let caught: unknown;

    try {
      await runner.run(7, work);
    } catch (error) {
      caught = error;
    }

    expect(caught).toMatchObject({
      stage: 'lock',
      commitOutcome: 'not-attempted',
      clientDisposition: 'released',
      cause: failure,
      rollbackError: undefined,
    });
    expect(work).not.toHaveBeenCalled();
    expect(transactionQueryCalls(client).map(({ text }) => text)).toEqual([
      expect.stringMatching(/^BEGIN TRANSACTION/),
      LOCK_SQL,
      'ROLLBACK',
    ]);
    expect(client.releases).toEqual([undefined]);
  });

  it('preserves a lock failure and a rollback failure before discarding the client', async () => {
    const lockFailure = new Error('lock failed');
    const rollbackFailure = new Error('rollback failed');
    const client = new FakePostgresClient({
      lockError: lockFailure,
      rollbackError: rollbackFailure,
    });
    const work = vi.fn();
    const runner = new PostgresAccountTransactionRunner(createPool([client]));

    let caught: unknown;

    try {
      await runner.run(7, work);
    } catch (error) {
      caught = error;
    }

    expect(caught).toMatchObject({
      stage: 'lock',
      commitOutcome: 'not-attempted',
      clientDisposition: 'discarded',
      cause: lockFailure,
      rollbackError: rollbackFailure,
    });
    expect(work).not.toHaveBeenCalled();
    expect(client.releases).toEqual([true]);
  });

  it('represents a missing account without calling work and releases the lock', async () => {
    const client = new FakePostgresClient({ lockRows: [] });
    const work = vi.fn();
    const runner = new PostgresAccountTransactionRunner(createPool([client]));

    await expect(runner.run(404, work)).resolves.toEqual({
      status: 'account-not-found',
    });

    expect(work).not.toHaveBeenCalled();
    expect(transactionQueryCalls(client).map(({ text }) => text)).toEqual([
      expect.stringMatching(/^BEGIN TRANSACTION/),
      LOCK_SQL,
      'ROLLBACK',
    ]);
    expect(client.releases).toEqual([undefined]);
  });

  it('fails safely when the missing-account rollback fails', async () => {
    const rollbackFailure = new Error('rollback failed');
    const client = new FakePostgresClient({
      lockRows: [],
      rollbackError: rollbackFailure,
    });
    const runner = new PostgresAccountTransactionRunner(createPool([client]));

    let caught: unknown;

    try {
      await runner.run(404, vi.fn());
    } catch (error) {
      caught = error;
    }

    expect(caught).toMatchObject({
      stage: 'rollback',
      commitOutcome: 'not-attempted',
      clientDisposition: 'discarded',
      cause: rollbackFailure,
      rollbackError: rollbackFailure,
    });
    expect(client.releases).toEqual([true]);
  });

  it('rolls back a work failure exactly once and preserves its original cause', async () => {
    const failure = new Error('business work failed');
    const client = new FakePostgresClient({ lockRows: [{ id: 7 }] });
    const work = vi.fn().mockRejectedValue(failure);
    const runner = new PostgresAccountTransactionRunner(createPool([client]));

    let caught: unknown;

    try {
      await runner.run(7, work);
    } catch (error) {
      caught = error;
    }

    expect(caught).toMatchObject({
      stage: 'work',
      commitOutcome: 'not-attempted',
      clientDisposition: 'released',
      cause: failure,
      rollbackError: undefined,
    });
    expect(work).toHaveBeenCalledTimes(1);
    expect(transactionQueryCalls(client).map(({ text }) => text)).toEqual([
      expect.stringMatching(/^BEGIN TRANSACTION/),
      LOCK_SQL,
      'ROLLBACK',
    ]);
    expect(client.releases).toEqual([undefined]);
    expect(client.calls.some(({ text }) => text === 'COMMIT')).toBe(false);
  });

  it('keeps the work failure and exposes a rollback failure while discarding the client', async () => {
    const workFailure = new Error('business work failed');
    const rollbackFailure = new Error('rollback failed');
    const client = new FakePostgresClient({
      lockRows: [{ id: 7 }],
      rollbackError: rollbackFailure,
    });
    const runner = new PostgresAccountTransactionRunner(createPool([client]));

    let caught: unknown;

    try {
      await runner.run(7, vi.fn().mockRejectedValue(workFailure));
    } catch (error) {
      caught = error;
    }

    expect(caught).toMatchObject({
      stage: 'work',
      commitOutcome: 'not-attempted',
      clientDisposition: 'discarded',
      cause: workFailure,
      rollbackError: rollbackFailure,
    });
    expect(client.releases).toEqual([true]);
  });

  it('classifies a serialization failure during the lock after a successful rollback', async () => {
    const failure = sqlStateError('40001');
    const client = new FakePostgresClient({ lockError: failure });
    const runner = new PostgresAccountTransactionRunner(createPool([client]));

    let caught: AccountTransactionError | undefined;

    try {
      await runner.run(7, vi.fn());
    } catch (error) {
      caught = error as AccountTransactionError;
    }

    expect(caught).toMatchObject({
      stage: 'lock',
      commitOutcome: 'not-attempted',
      clientDisposition: 'released',
      rollbackError: undefined,
      transientFailure: 'serialization-failure',
    });
    expect(caught?.releaseError).toBeUndefined();
    expect(transactionQueryCalls(client).map(({ text }) => text)).toEqual([
      expect.stringMatching(/^BEGIN TRANSACTION/),
      LOCK_SQL,
      'ROLLBACK',
    ]);
  });

  it('classifies a deadlock during work after a successful rollback', async () => {
    const failure = sqlStateError('40P01');
    const client = new FakePostgresClient({ lockRows: [{ id: 7 }] });
    const runner = new PostgresAccountTransactionRunner(createPool([client]));

    let caught: AccountTransactionError | undefined;

    try {
      await runner.run(7, vi.fn().mockRejectedValue(failure));
    } catch (error) {
      caught = error as AccountTransactionError;
    }

    expect(caught).toMatchObject({
      stage: 'work',
      commitOutcome: 'not-attempted',
      clientDisposition: 'released',
      rollbackError: undefined,
      transientFailure: 'deadlock',
    });
    expect(client.releases).toEqual([undefined]);
  });

  it('does not classify other SQLSTATE codes as transient', async () => {
    const client = new FakePostgresClient({ lockRows: [{ id: 7 }] });
    const runner = new PostgresAccountTransactionRunner(createPool([client]));

    let caught: AccountTransactionError | undefined;

    try {
      await runner.run(7, vi.fn().mockRejectedValue(sqlStateError('23505')));
    } catch (error) {
      caught = error as AccountTransactionError;
    }

    expect(caught).toMatchObject({
      stage: 'work',
      transientFailure: undefined,
      rollbackError: undefined,
      clientDisposition: 'released',
    });
  });

  it('does not classify a transient SQLSTATE when rollback fails', async () => {
    const failure = sqlStateError('40001');
    const rollbackFailure = new Error('rollback failed');
    const client = new FakePostgresClient({
      lockRows: [{ id: 7 }],
      rollbackError: rollbackFailure,
    });
    const runner = new PostgresAccountTransactionRunner(createPool([client]));

    let caught: AccountTransactionError | undefined;

    try {
      await runner.run(7, vi.fn().mockRejectedValue(failure));
    } catch (error) {
      caught = error as AccountTransactionError;
    }

    expect(caught).toMatchObject({
      stage: 'work',
      transientFailure: undefined,
      rollbackError: rollbackFailure,
      clientDisposition: 'discarded',
    });
  });

  it('does not expose a transient failure when releasing the client fails', async () => {
    const failure = sqlStateError('40P01');
    const releaseFailure = new Error('release failed');
    const client = new FakePostgresClient({
      lockRows: [{ id: 7 }],
      releaseError: releaseFailure,
    });
    const runner = new PostgresAccountTransactionRunner(createPool([client]));

    let caught: AccountTransactionError | undefined;

    try {
      await runner.run(7, vi.fn().mockRejectedValue(failure));
    } catch (error) {
      caught = error as AccountTransactionError;
    }

    expect(caught).toMatchObject({
      stage: 'work',
      transientFailure: undefined,
      releaseError: releaseFailure,
      clientDisposition: 'unknown',
    });
  });

  it('does not classify transient SQLSTATE codes from a connection failure', async () => {
    const failure = sqlStateError('40001');
    const runner = new PostgresAccountTransactionRunner({
      connect: vi.fn().mockRejectedValue(failure),
    });

    let caught: AccountTransactionError | undefined;

    try {
      await runner.run(7, vi.fn());
    } catch (error) {
      caught = error as AccountTransactionError;
    }

    expect(caught).toMatchObject({
      stage: 'connection',
      transientFailure: undefined,
      commitOutcome: 'not-attempted',
      clientDisposition: 'not-acquired',
    });
  });

  it('does not classify transient SQLSTATE codes from BEGIN or COMMIT', async () => {
    const beginClient = new FakePostgresClient({
      beginError: sqlStateError('40001'),
    });
    const beginRunner = new PostgresAccountTransactionRunner(
      createPool([beginClient]),
    );
    let beginError: AccountTransactionError | undefined;

    try {
      await beginRunner.run(7, vi.fn());
    } catch (error) {
      beginError = error as AccountTransactionError;
    }

    expect(beginError).toMatchObject({
      stage: 'begin',
      transientFailure: undefined,
      commitOutcome: 'not-attempted',
    });

    const commitClient = new FakePostgresClient({
      lockRows: [{ id: 7 }],
      commitError: sqlStateError('40001'),
    });
    const commitRunner = new PostgresAccountTransactionRunner(
      createPool([commitClient]),
    );
    let commitError: AccountTransactionError | undefined;

    try {
      await commitRunner.run(7, vi.fn().mockResolvedValue('value'));
    } catch (error) {
      commitError = error as AccountTransactionError;
    }

    expect(commitError).toMatchObject({
      stage: 'commit',
      transientFailure: undefined,
      commitOutcome: 'uncertain',
      clientDisposition: 'discarded',
    });
  });

  it('does not return a value or claim rollback when COMMIT is uncertain', async () => {
    const failure = new Error('connection lost during commit');
    const client = new FakePostgresClient({
      lockRows: [{ id: 7 }],
      commitError: failure,
    });
    const work = vi.fn().mockResolvedValue('value');
    const runner = new PostgresAccountTransactionRunner(createPool([client]));

    let caught: unknown;

    try {
      await runner.run(7, work);
    } catch (error) {
      caught = error;
    }

    expect(caught).toMatchObject({
      stage: 'commit',
      commitOutcome: 'uncertain',
      clientDisposition: 'discarded',
      cause: failure,
      rollbackError: undefined,
    });
    expect(work).toHaveBeenCalledTimes(1);
    expect(transactionQueryCalls(client).map(({ text }) => text)).toEqual([
      expect.stringMatching(/^BEGIN TRANSACTION/),
      LOCK_SQL,
      'COMMIT',
      'ROLLBACK',
    ]);
    expect(client.releases).toEqual([true]);
  });

  it('rejects a known rollback when COMMIT returns ROLLBACK instead of COMMIT', async () => {
    const client = new FakePostgresClient({
      lockRows: [{ id: 7 }],
      commitCommand: 'ROLLBACK',
    });
    const work = vi.fn().mockResolvedValue('value');
    const runner = new PostgresAccountTransactionRunner(createPool([client]));

    let caught: AccountTransactionError | undefined;

    try {
      await runner.run(7, work);
    } catch (error) {
      caught = error as AccountTransactionError;
    }

    expect(caught).toBeInstanceOf(AccountTransactionError);
    expect(caught).toMatchObject({
      stage: 'commit',
      commitOutcome: 'rolled-back',
      clientDisposition: 'released',
      commitCommand: 'ROLLBACK',
      rollbackError: undefined,
    });
    expect(caught?.cause).toBeInstanceOf(Error);
    expect((caught?.cause as Error).message).toBe(
      'PostgreSQL rolled back the transaction instead of committing it.',
    );
    expect(work).toHaveBeenCalledTimes(1);
    expect(transactionQueryCalls(client).map(({ text }) => text)).toEqual([
      expect.stringMatching(/^BEGIN TRANSACTION/),
      LOCK_SQL,
      'COMMIT',
    ]);
    expect(client.releases).toEqual([undefined]);
  });

  it('treats an unexpected COMMIT command as uncertain and discards the client', async () => {
    const client = new FakePostgresClient({
      lockRows: [{ id: 7 }],
      commitCommand: 'SELECT',
    });
    const work = vi.fn().mockResolvedValue('value');
    const runner = new PostgresAccountTransactionRunner(createPool([client]));

    let caught: AccountTransactionError | undefined;

    try {
      await runner.run(7, work);
    } catch (error) {
      caught = error as AccountTransactionError;
    }

    expect(caught).toMatchObject({
      stage: 'commit',
      commitOutcome: 'uncertain',
      clientDisposition: 'discarded',
      commitCommand: 'SELECT',
      rollbackError: undefined,
    });
    expect((caught?.cause as Error).message).toBe(
      'PostgreSQL returned an unexpected command for COMMIT.',
    );
    expect(work).toHaveBeenCalledTimes(1);
    expect(transactionQueryCalls(client).map(({ text }) => text)).toEqual([
      expect.stringMatching(/^BEGIN TRANSACTION/),
      LOCK_SQL,
      'COMMIT',
      'ROLLBACK',
    ]);
    expect(client.releases).toEqual([true]);
  });

  it('keeps a release failure after a known rollback without hiding the cause', async () => {
    const releaseFailure = new Error('release failed');
    const client = new FakePostgresClient({
      lockRows: [{ id: 7 }],
      commitCommand: 'ROLLBACK',
      releaseError: releaseFailure,
    });
    const runner = new PostgresAccountTransactionRunner(createPool([client]));

    let caught: AccountTransactionError | undefined;

    try {
      await runner.run(7, vi.fn().mockResolvedValue('value'));
    } catch (error) {
      caught = error as AccountTransactionError;
    }

    expect(caught).toMatchObject({
      stage: 'commit',
      commitOutcome: 'rolled-back',
      clientDisposition: 'unknown',
      commitCommand: 'ROLLBACK',
    });
    expect(caught?.releaseError).toBe(releaseFailure);
    expect((caught?.cause as Error).message).toBe(
      'PostgreSQL rolled back the transaction instead of committing it.',
    );
    expect(transactionQueryCalls(client).map(({ text }) => text)).toEqual([
      expect.stringMatching(/^BEGIN TRANSACTION/),
      LOCK_SQL,
      'COMMIT',
    ]);
    expect(client.releases).toEqual([undefined]);
  });

  it('keeps a failed COMMIT and a failed cleanup attempt as separate evidence', async () => {
    const commitFailure = new Error('commit failed');
    const rollbackFailure = new Error('rollback failed');
    const client = new FakePostgresClient({
      lockRows: [{ id: 7 }],
      commitError: commitFailure,
      rollbackError: rollbackFailure,
    });
    const runner = new PostgresAccountTransactionRunner(createPool([client]));

    let caught: unknown;

    try {
      await runner.run(7, vi.fn().mockResolvedValue('value'));
    } catch (error) {
      caught = error;
    }

    expect(caught).toMatchObject({
      stage: 'commit',
      commitOutcome: 'uncertain',
      clientDisposition: 'discarded',
      cause: commitFailure,
      rollbackError: rollbackFailure,
    });
    expect(client.releases).toEqual([true]);
  });

  it('reports a release failure after COMMIT as confirmed but does not return the value', async () => {
    const releaseFailure = new Error('release failed');
    const client = new FakePostgresClient({
      lockRows: [{ id: 7 }],
      releaseError: releaseFailure,
    });
    const runner = new PostgresAccountTransactionRunner(createPool([client]));

    let caught: unknown;

    try {
      await runner.run(7, vi.fn().mockResolvedValue('value'));
    } catch (error) {
      caught = error;
    }

    expect(caught).toMatchObject({
      stage: 'release',
      commitOutcome: 'confirmed',
      clientDisposition: 'unknown',
      cause: releaseFailure,
    });
  });

  it('does not lose the original work error when releasing the client fails', async () => {
    const workFailure = new Error('business work failed');
    const releaseFailure = new Error('release failed');
    const client = new FakePostgresClient({
      lockRows: [{ id: 7 }],
      releaseError: releaseFailure,
    });
    const runner = new PostgresAccountTransactionRunner(createPool([client]));

    let caught: AccountTransactionError | undefined;

    try {
      await runner.run(7, vi.fn().mockRejectedValue(workFailure));
    } catch (error) {
      caught = error as AccountTransactionError;
    }

    expect(caught).toMatchObject({
      stage: 'work',
      commitOutcome: 'not-attempted',
      clientDisposition: 'unknown',
      cause: workFailure,
    });
    expect(caught?.releaseError).toBe(releaseFailure);
    expect(client.releases).toEqual([undefined]);
  });

  it('warns once when a COMMIT outcome is uncertain', async () => {
    const logger = new RecordingLogger();
    const client = new FakePostgresClient({
      lockRows: [{ id: 7 }],
      commitError: sqlStateError('08006'),
    });
    const runner = new PostgresAccountTransactionRunner(
      createPool([client]),
      logger,
    );

    await expect(
      runner.run(7, vi.fn().mockResolvedValue('value')),
    ).rejects.toMatchObject({
      stage: 'commit',
      commitOutcome: 'uncertain',
    });

    expect(logger.entries).toEqual([
      {
        level: 'warn',
        event: 'orders.transaction.commit_uncertain',
        fields: {
          stage: 'commit',
          commitOutcome: 'uncertain',
          code: '08006',
        },
      },
    ]);
  });

  it('logs rollback and release failures as definitive technical errors', async () => {
    const logger = new RecordingLogger();
    const rollbackFailure = sqlStateError('08006');
    const releaseFailure = sqlStateError('08006');
    const client = new FakePostgresClient({
      lockRows: [{ id: 7 }],
      lockError: sqlStateError('40001'),
      rollbackError: rollbackFailure,
      releaseError: releaseFailure,
    });
    const runner = new PostgresAccountTransactionRunner(
      createPool([client]),
      logger,
    );

    await expect(
      runner.run(7, vi.fn().mockResolvedValue('value')),
    ).rejects.toMatchObject({
      stage: 'lock',
      commitOutcome: 'not-attempted',
    });

    expect(logger.events('error')).toEqual([
      'orders.transaction.rollback_failed',
      'orders.transaction.release_failed',
    ]);
    expect(logger.entries[0]?.fields).toMatchObject({
      stage: 'rollback',
      commitOutcome: 'not-attempted',
      code: '08006',
      rollbackFailed: true,
    });
    expect(logger.entries[1]?.fields).toMatchObject({
      stage: 'release',
      commitOutcome: 'not-attempted',
      code: '08006',
      releaseFailed: true,
    });
  });
});

const LOCK_SQL = 'SELECT id FROM users WHERE id = $1 FOR UPDATE';

function sqlStateError(code: string): Error {
  return Object.assign(new Error(`forced SQLSTATE ${code}`), { code });
}

function queryLabel(text: string): string {
  if (isBegin(text)) {
    return 'begin';
  }

  if (isLockAccount(text)) {
    return 'lock';
  }

  if (text === 'COMMIT') {
    return 'commit';
  }

  if (text === 'ROLLBACK') {
    return 'rollback';
  }

  return 'other';
}
