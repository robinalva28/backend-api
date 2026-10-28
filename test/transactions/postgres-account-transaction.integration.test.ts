import { Test, type TestingModule } from '@nestjs/testing';
import type { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { AppModule } from '../../src/app.module.js';
import type { LatestQuoteRepository } from '../../src/quotes/application/ports/out/latest-quote.repository.js';
import { LATEST_QUOTE_REPOSITORY } from '../../src/quotes/quotes.tokens.js';
import type { AccountMovementRepository } from '../../src/resources/application/ports/out/account-movement.repository.js';
import { ACCOUNT_MOVEMENT_REPOSITORY } from '../../src/resources/resources.tokens.js';
import { AccountTransactionError } from '../../src/transactions/application/errors/account-transaction.error.js';
import type {
  AccountTransactionResult,
  AccountTransactionRunner,
} from '../../src/transactions/application/ports/out/account-transaction.port.js';
import { PostgresAccountTransactionRunner } from '../../src/transactions/infrastructure/persistence/postgres-account-transaction.runner.js';
import { ACCOUNT_TRANSACTION_RUNNER } from '../../src/transactions/transactions.tokens.js';
import { RecordingConnectionPool } from '../support/recording-pool.js';
import { createTestPool } from '../support/test-database.js';

const FIRST_FIXTURE_ID = 4101;
const LAST_FIXTURE_ID = 4199;

const READ_USER_ID = 4101;
const LOCK_USER_ID = 4102;
const OTHER_USER_ID = 4103;
const ROLLBACK_USER_ID = 4104;
const COMPOSITION_USER_ID = 4105;
const COMMIT_ROLLBACK_USER_ID = 4106;
const MISSING_USER_ID = 4199;

const FIRST_INSTRUMENT_ID = 4101;
const SECOND_INSTRUMENT_ID = 4102;
const CASH_INSTRUMENT_ID = 4103;
const QUOTE_ID = 4101;

const LOCKED_EMAIL = 'b04a-locked@example.invalid';

interface FixtureOrder {
  readonly instrumentId: number;
  readonly userId: number;
  readonly size: number;
  readonly price: string;
  readonly side: 'BUY' | 'CASH_IN';
  readonly status: 'FILLED';
  readonly type: 'MARKET';
}

const users = [
  { id: READ_USER_ID, accountNumber: 'B04A01' },
  { id: LOCK_USER_ID, accountNumber: 'B04A02' },
  { id: OTHER_USER_ID, accountNumber: 'B04A03' },
  { id: ROLLBACK_USER_ID, accountNumber: 'B04A04' },
  { id: COMPOSITION_USER_ID, accountNumber: 'B04A05' },
  { id: COMMIT_ROLLBACK_USER_ID, accountNumber: 'B04A06' },
] as const;

const orders: readonly FixtureOrder[] = [
  {
    instrumentId: FIRST_INSTRUMENT_ID,
    userId: READ_USER_ID,
    size: 2,
    price: '100.00',
    side: 'BUY',
    status: 'FILLED',
    type: 'MARKET',
  },
  {
    instrumentId: FIRST_INSTRUMENT_ID,
    userId: LOCK_USER_ID,
    size: 1,
    price: '100.00',
    side: 'BUY',
    status: 'FILLED',
    type: 'MARKET',
  },
  {
    instrumentId: CASH_INSTRUMENT_ID,
    userId: OTHER_USER_ID,
    size: 1_000,
    price: '1.00',
    side: 'CASH_IN',
    status: 'FILLED',
    type: 'MARKET',
  },
  {
    instrumentId: SECOND_INSTRUMENT_ID,
    userId: COMPOSITION_USER_ID,
    size: 1,
    price: '100.00',
    side: 'BUY',
    status: 'FILLED',
    type: 'MARKET',
  },
];

let pool: Pool;
let moduleRef: TestingModule | undefined;
let moduleRunner: AccountTransactionRunner;
let seedOrderCount = 0;
let seedQuoteCount = 0;

beforeAll(async () => {
  pool = createTestPool();
  await resetFixtures(pool);

  const orderCount = await pool.query<{ count: number }>(
    'SELECT count(*)::int AS count FROM orders',
  );
  seedOrderCount = orderCount.rows[0]?.count ?? 0;

  const quoteCount = await pool.query<{ count: number }>(
    'SELECT count(*)::int AS count FROM marketdata',
  );
  seedQuoteCount = quoteCount.rows[0]?.count ?? 0;

  for (const user of users) {
    await pool.query(
      'INSERT INTO users (id, email, accountnumber) VALUES ($1, $2, $3)',
      [
        user.id,
        `b04a-${user.id}@example.invalid`,
        user.accountNumber,
      ],
    );
  }

  await pool.query(
    `INSERT INTO instruments (id, ticker, name, type)
     VALUES ($1, 'B04A', 'B04A account fixture', 'ACCIONES'),
            ($2, 'B04B', 'B04B account fixture', 'ACCIONES'),
            ($3, 'B04CASH', 'B04A cash fixture', 'MONEDA')`,
    [FIRST_INSTRUMENT_ID, SECOND_INSTRUMENT_ID, CASH_INSTRUMENT_ID],
  );

  for (const [index, order] of orders.entries()) {
    await pool.query(
      `INSERT INTO orders
         (instrumentId, userId, size, price, type, side, status, datetime)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [
        order.instrumentId,
        order.userId,
        order.size,
        order.price,
        order.type,
        order.side,
        order.status,
        `2026-10-28 12:00:${String(index).padStart(2, '0')}`,
      ],
    );
  }

  await pool.query(
    `INSERT INTO marketdata
       (id, instrumentid, date, open, high, low, close, previousclose)
     VALUES ($1, $2, '2023-07-14', 120.00, 125.00, 119.00, 123.45, 120.00)`,
    [QUOTE_ID, FIRST_INSTRUMENT_ID],
  );

  moduleRef = await Test.createTestingModule({
    imports: [AppModule],
  }).compile();
  await moduleRef.init();
  moduleRunner = moduleRef.get<AccountTransactionRunner>(
    ACCOUNT_TRANSACTION_RUNNER,
  );
});

afterAll(async () => {
  try {
    await resetFixtures(pool);
  } finally {
    await moduleRef?.close();
    await pool.end();
  }
});

describe('Postgres account transaction against PostgreSQL', () => {
  it('is composed by the application module and reuses the shared pool', async () => {
    expect(moduleRunner).toBeDefined();
    expect(moduleRef?.get(ACCOUNT_TRANSACTION_RUNNER)).toBe(moduleRunner);

    const result = await moduleRunner.run(
      COMPOSITION_USER_ID,
      async (context) => {
        const movements = await context.accountMovements.findByUserId(
          COMPOSITION_USER_ID,
        );

        return {
          count: movements.length,
          accountMovements: context.accountMovements,
          latestQuotes: context.latestQuotes,
        };
      },
    );

    expect(result.status).toBe('committed');

    if (result.status !== 'committed') {
      throw new Error('Expected a committed transaction.');
    }

    expect(result.value.count).toBe(1);
    expect(result.value.accountMovements).not.toBe(
      moduleRef?.get<AccountMovementRepository>(ACCOUNT_MOVEMENT_REPOSITORY),
    );
    expect(result.value.latestQuotes).not.toBe(
      moduleRef?.get<LatestQuoteRepository>(LATEST_QUOTE_REPOSITORY),
    );
  });

  it('runs the transaction with effective READ COMMITTED isolation', async () => {
    const recorder = new RecordingConnectionPool(pool);
    const runner = new PostgresAccountTransactionRunner(recorder);

    const result = await runner.run(READ_USER_ID, async () => {
      const isolation = await recorder.latest.query<{
        transaction_isolation: string;
      }>('SHOW transaction_isolation', []);

      return isolation.rows[0]?.transaction_isolation;
    });

    expect(result).toEqual({ status: 'committed', value: 'read committed' });
  });

  it('binds context reads to the transaction client, including uncommitted rows and quotes', async () => {
    const recorder = new RecordingConnectionPool(pool);
    const runner = new PostgresAccountTransactionRunner(recorder);

    const result = await runner.run(READ_USER_ID, async (context) => {
      const inserted = await recorder.latest.query<{ id: number }>(
        `INSERT INTO orders
           (instrumentId, userId, size, price, type, side, status, datetime)
         VALUES ($1, $2, 3, '50.00', 'MARKET', 'BUY', 'FILLED', $3)
         RETURNING id`,
        [FIRST_INSTRUMENT_ID, READ_USER_ID, '2026-10-28 13:00:00'],
      );
      const movements = await context.accountMovements.findByUserId(
        READ_USER_ID,
      );
      const quote = await context.latestQuotes.findLatestByInstrumentId(
        FIRST_INSTRUMENT_ID,
      );

      return {
        insertedId: inserted.rows[0]?.id,
        movementIds: movements.map((movement) => movement.id),
        quote,
      };
    });

    expect(result.status).toBe('committed');

    if (result.status !== 'committed') {
      throw new Error('Expected a committed transaction.');
    }

    expect(result.value.insertedId).toBeDefined();
    expect(result.value.movementIds).toContain(result.value.insertedId);
    expect(result.value.quote).toEqual({
      id: QUOTE_ID,
      instrumentId: FIRST_INSTRUMENT_ID,
      date: '2023-07-14',
      close: '123.45',
      previousClose: '120.00',
    });

    const committed = await pool.query<{ count: number }>(
      'SELECT count(*)::int AS count FROM orders WHERE id = $1',
      [result.value.insertedId],
    );

    expect(committed.rows[0]?.count).toBe(1);
  });

  it('serializes one account, lets another account progress, and the waiter sees the committed change', async () => {
    const recorderOther = new RecordingConnectionPool(pool);
    const runnerOther = new PostgresAccountTransactionRunner(recorderOther);
    const otherWork = vi.fn(async (context: { userId: number }) => {
      const movements = await recorderOther.latest.query<{ count: number }>(
        'SELECT count(*)::int AS count FROM orders WHERE userid = $1',
        [context.userId],
      );

      return movements.rows[0]?.count;
    });

    const scenario = await runConcurrentScenario(pool, async () => {
      const otherResult = await withTimeout(
        runnerOther.run(OTHER_USER_ID, otherWork),
        2_000,
        'A different account did not progress while the first one was locked.',
      );

      expect(otherResult).toEqual({ status: 'committed', value: 1 });
      expect(otherWork).toHaveBeenCalledTimes(1);
    });

    expect(scenario.first).toEqual({
      status: 'committed',
      value: 'first-operation',
    });
    expect(scenario.waiting).toEqual({
      status: 'committed',
      value: LOCKED_EMAIL,
    });
    expect(scenario.waitingWorkCalls).toBe(1);
  });

  it('cleans up signals and operations when the concurrent scenario fails', async () => {
    const controlledFailure = new Error('controlled concurrent failure');
    let caught: unknown;

    try {
      await runConcurrentScenario(pool, async () => {
        throw controlledFailure;
      });
    } catch (error) {
      caught = error;
    }

    expect(caught).toBe(controlledFailure);

    const runner = new PostgresAccountTransactionRunner(
      new RecordingConnectionPool(pool),
    );
    const result = await withTimeout(
      runner.run(LOCK_USER_ID, async (context) => {
        const movements = await context.accountMovements.findByUserId(
          LOCK_USER_ID,
        );

        return movements.length;
      }),
      2_000,
      'The account lock was not released after the failed concurrent scenario.',
    );

    expect(result.status).toBe('committed');
  });

  it('rolls back fixture writes, releases the lock and allows a later operation', async () => {
    const recorder = new RecordingConnectionPool(pool);
    const runner = new PostgresAccountTransactionRunner(recorder);
    const failure = new Error('fixture work failed');
    const failingWork = vi.fn(async () => {
      await recorder.latest.query(
        `INSERT INTO orders
           (instrumentId, userId, size, price, type, side, status, datetime)
         VALUES ($1, $2, 5, '25.00', 'MARKET', 'BUY', 'FILLED', $3)`,
        [FIRST_INSTRUMENT_ID, ROLLBACK_USER_ID, '2026-10-28 14:00:00'],
      );

      throw failure;
    });

    let caught: unknown;

    try {
      await runner.run(ROLLBACK_USER_ID, failingWork);
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(AccountTransactionError);
    expect(caught).toMatchObject({
      stage: 'work',
      commitOutcome: 'not-attempted',
      clientDisposition: 'released',
      cause: failure,
      rollbackError: undefined,
    });
    expect(failingWork).toHaveBeenCalledTimes(1);

    const afterRollback = await pool.query<{ count: number }>(
      'SELECT count(*)::int AS count FROM orders WHERE userid = $1',
      [ROLLBACK_USER_ID],
    );
    expect(afterRollback.rows[0]?.count).toBe(0);

    const laterResult = await withTimeout(
      runner.run(ROLLBACK_USER_ID, async () => {
        const inserted = await recorder.latest.query<{ id: number }>(
          `INSERT INTO orders
             (instrumentId, userId, size, price, type, side, status, datetime)
           VALUES ($1, $2, 1, '10.00', 'MARKET', 'BUY', 'FILLED', $3)
           RETURNING id`,
          [FIRST_INSTRUMENT_ID, ROLLBACK_USER_ID, '2026-10-28 14:05:00'],
        );

        return inserted.rows[0]?.id;
      }),
      2_000,
      'A later operation did not continue after the rollback.',
    );

    expect(laterResult.status).toBe('committed');
    const afterLaterOperation = await pool.query<{ count: number }>(
      'SELECT count(*)::int AS count FROM orders WHERE userid = $1',
      [ROLLBACK_USER_ID],
    );
    expect(afterLaterOperation.rows[0]?.count).toBe(1);
  });

  it('rejects a real COMMIT that returns ROLLBACK and proves the write was reverted', async () => {
    const recorder = new RecordingConnectionPool(pool);
    const runner = new PostgresAccountTransactionRunner(recorder);
    const work = vi.fn(async () => {
      await recorder.latest.query(
        `INSERT INTO orders
           (instrumentId, userId, size, price, type, side, status, datetime)
         VALUES ($1, $2, 4, '20.00', 'MARKET', 'BUY', 'FILLED', $3)`,
        [FIRST_INSTRUMENT_ID, COMMIT_ROLLBACK_USER_ID, '2026-10-28 14:30:00'],
      );

      try {
        await recorder.latest.query('SELECT 1 / 0', []);
      } catch (error) {
        expect(error).toMatchObject({ code: '22012' });
      }

      return 'work-resolved';
    });

    let caught: AccountTransactionError | undefined;

    try {
      await runner.run(COMMIT_ROLLBACK_USER_ID, work);
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
    expect(work).toHaveBeenCalledTimes(1);

    const afterKnownRollback = await pool.query<{ count: number }>(
      'SELECT count(*)::int AS count FROM orders WHERE userid = $1',
      [COMMIT_ROLLBACK_USER_ID],
    );
    expect(afterKnownRollback.rows[0]?.count).toBe(0);

    const laterResult = await withTimeout(
      runner.run(COMMIT_ROLLBACK_USER_ID, async () => {
        const inserted = await recorder.latest.query<{ id: number }>(
          `INSERT INTO orders
             (instrumentId, userId, size, price, type, side, status, datetime)
           VALUES ($1, $2, 1, '10.00', 'MARKET', 'BUY', 'FILLED', $3)
           RETURNING id`,
          [FIRST_INSTRUMENT_ID, COMMIT_ROLLBACK_USER_ID, '2026-10-28 14:35:00'],
        );

        return inserted.rows[0]?.id;
      }),
      2_000,
      'A later operation did not continue after the known rollback.',
    );

    expect(laterResult.status).toBe('committed');
    const afterLaterOperation = await pool.query<{ count: number }>(
      'SELECT count(*)::int AS count FROM orders WHERE userid = $1',
      [COMMIT_ROLLBACK_USER_ID],
    );
    expect(afterLaterOperation.rows[0]?.count).toBe(1);
  });

  it('represents a missing account without running work', async () => {
    const runner = new PostgresAccountTransactionRunner(
      new RecordingConnectionPool(pool),
    );
    const work = vi.fn();

    await expect(runner.run(MISSING_USER_ID, work)).resolves.toEqual({
      status: 'account-not-found',
    });

    expect(work).not.toHaveBeenCalled();
  });

  it('leaves the seed and unrelated fixtures unchanged', async () => {
    const orderCount = await pool.query<{ count: number }>(
      'SELECT count(*)::int AS count FROM orders WHERE userid < $1',
      [FIRST_FIXTURE_ID],
    );
    const quoteCount = await pool.query<{ count: number }>(
      'SELECT count(*)::int AS count FROM marketdata WHERE id < $1',
      [FIRST_FIXTURE_ID],
    );

    expect(orderCount.rows[0]?.count).toBe(seedOrderCount);
    expect(quoteCount.rows[0]?.count).toBe(seedQuoteCount);
  });
});

interface Deferred<T> {
  readonly promise: Promise<T>;
  resolve: (value: T | PromiseLike<T>) => void;
  reject: (reason?: unknown) => void;
}

interface ConcurrentScenarioResult {
  readonly first: AccountTransactionResult<string>;
  readonly waiting: AccountTransactionResult<string>;
  readonly waitingWorkCalls: number;
}

function deferred<T>(): Deferred<T> {
  let resolve: (value: T | PromiseLike<T>) => void = () => undefined;
  let reject: (reason?: unknown) => void = () => undefined;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });

  return { promise, resolve, reject };
}

async function withTimeout<T>(
  promise: Promise<T>,
  milliseconds: number,
  message: string,
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;

  try {
    return await Promise.race([
      promise,
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => reject(new Error(message)), milliseconds);
      }),
    ]);
  } finally {
    if (timer !== undefined) {
      clearTimeout(timer);
    }
  }
}

async function runConcurrentScenario(
  target: Pool,
  duringWait?: () => Promise<void>,
): Promise<ConcurrentScenarioResult> {
  const recorderA = new RecordingConnectionPool(target);
  const recorderB = new RecordingConnectionPool(target);
  const runnerA = new PostgresAccountTransactionRunner(recorderA);
  const runnerB = new PostgresAccountTransactionRunner(recorderB);
  const lockHeld = deferred<void>();
  const releaseA = deferred<void>();
  let lockHolderPid = 0;
  let waitingWorkCalls = 0;
  let runA: Promise<AccountTransactionResult<string>> | undefined;
  let runB: Promise<AccountTransactionResult<string>> | undefined;
  let primaryError: unknown;
  let cleanupError: unknown;
  let settlement:
    | PromiseSettledResult<AccountTransactionResult<string>>[]
    | undefined;

  try {
    runA = runnerA.run(LOCK_USER_ID, async () => {
      const pid = await recorderA.latest.query<{ pid: number }>(
        'SELECT pg_backend_pid() AS pid',
        [],
      );
      lockHolderPid = pid.rows[0]?.pid ?? 0;

      await recorderA.latest.query(
        'UPDATE users SET email = $1 WHERE id = $2',
        [LOCKED_EMAIL, LOCK_USER_ID],
      );
      lockHeld.resolve();

      await releaseA.promise;

      return 'first-operation';
    });
    void runA?.catch(() => undefined);

    await withTimeout(lockHeld.promise, 2_000, 'Account lock was not acquired.');
    expect(lockHolderPid).toBeGreaterThan(0);
    await assertAccountRowLocked(target, LOCK_USER_ID);

    runB = runnerB.run(LOCK_USER_ID, async () => {
      waitingWorkCalls += 1;

      const email = await recorderB.latest.query<{ email: string }>(
        'SELECT email FROM users WHERE id = $1',
        [LOCK_USER_ID],
      );
      const row = email.rows[0];

      if (row === undefined) {
        throw new Error('The waiting operation did not read the account row.');
      }

      return row.email;
    });
    void runB?.catch(() => undefined);

    await waitForLockWaiter(target, lockHolderPid);
    expect(waitingWorkCalls).toBe(0);

    await duringWait?.();

    expect(waitingWorkCalls).toBe(0);
  } catch (error) {
    primaryError = error;
  } finally {
    releaseA.resolve();
  }

  try {
    settlement = await withTimeout(
      Promise.allSettled([
        ...(runA === undefined ? [] : [runA]),
        ...(runB === undefined ? [] : [runB]),
      ]),
      2_000,
      'Concurrent operations did not settle during cleanup.',
    );
  } catch (error) {
    cleanupError = error;
  }

  if (primaryError !== undefined) {
    throw primaryError;
  }

  if (cleanupError !== undefined) {
    throw cleanupError;
  }

  if (settlement === undefined) {
    throw new Error('Concurrent cleanup did not produce a settlement.');
  }

  const rejected = settlement.find(
    (outcome): outcome is PromiseRejectedResult => outcome.status === 'rejected',
  );

  if (rejected !== undefined) {
    throw rejected.reason;
  }

  if (settlement.length !== 2) {
    throw new Error('Both concurrent operations must start before they settle.');
  }

  const first = settlement[0];
  const waiting = settlement[1];

  if (first?.status !== 'fulfilled' || waiting?.status !== 'fulfilled') {
    throw new Error('Both concurrent operations must settle successfully.');
  }

  return {
    first: first.value,
    waiting: waiting.value,
    waitingWorkCalls,
  };
}

async function assertAccountRowLocked(
  target: Pool,
  userId: number,
): Promise<void> {
  const client = await target.connect();

  try {
    await client.query('BEGIN', []);
    let lockRejected = false;

    try {
      await client.query(
        'SELECT id FROM users WHERE id = $1 FOR UPDATE NOWAIT',
        [userId],
      );
    } catch (error) {
      expect(error).toMatchObject({ code: '55P03' });
      lockRejected = true;
    } finally {
      await client.query('ROLLBACK', []);
    }

    expect(lockRejected).toBe(true);
  } finally {
    client.release();
  }
}

async function waitForLockWaiter(
  target: Pool,
  blockerPid: number,
): Promise<void> {
  const deadline = Date.now() + 2_000;

  while (Date.now() < deadline) {
    const waiter = await target.query<{ pid: number }>(
      `SELECT pid
         FROM pg_stat_activity
        WHERE datname = current_database()
          AND wait_event_type = 'Lock'
          AND $1 = ANY(pg_blocking_pids(pid))`,
      [blockerPid],
    );

    if (waiter.rows.length > 0) {
      return;
    }

    await new Promise((resolve) => setTimeout(resolve, 10));
  }

  throw new Error(
    `No PostgreSQL backend was waiting on the account held by ${blockerPid}.`,
  );
}

async function resetFixtures(target: Pool): Promise<void> {
  await target.query('DELETE FROM orders WHERE userid BETWEEN $1 AND $2', [
    FIRST_FIXTURE_ID,
    LAST_FIXTURE_ID,
  ]);
  await target.query('DELETE FROM marketdata WHERE id BETWEEN $1 AND $2', [
    FIRST_FIXTURE_ID,
    LAST_FIXTURE_ID,
  ]);
  await target.query('DELETE FROM instruments WHERE id BETWEEN $1 AND $2', [
    FIRST_FIXTURE_ID,
    LAST_FIXTURE_ID,
  ]);
  await target.query('DELETE FROM users WHERE id BETWEEN $1 AND $2', [
    FIRST_FIXTURE_ID,
    LAST_FIXTURE_ID,
  ]);
}
