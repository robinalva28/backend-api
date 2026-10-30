import { describe, expect, it, vi } from 'vitest';
import { SubmitOrderError } from '../../src/orders/application/errors/submit-order.error.js';
import { RetryingSubmitOrderRunner } from '../../src/orders/application/retrying-submit-order.runner.js';
import { AccountTransactionError } from '../../src/transactions/application/errors/account-transaction.error.js';
import { RecordingLogger } from '../support/recording-logger.js';
import type {
  AccountTransactionContext,
  AccountTransactionResult,
  AccountTransactionRunner,
} from '../../src/transactions/application/ports/out/account-transaction.port.js';

const USER_ID = 5801;
const DELAYS = [50] as const;

class ScriptedRunner implements AccountTransactionRunner {
  readonly userIds: number[] = [];
  readonly works: Array<
    (context: AccountTransactionContext) => Promise<unknown>
  > = [];

  constructor(
    private readonly outcomes: readonly unknown[],
    private readonly events?: string[],
  ) {}

  async run<T>(
    userId: number,
    work: (context: AccountTransactionContext) => Promise<T>,
  ): Promise<AccountTransactionResult<T>> {
    this.userIds.push(userId);
    this.works.push(work);
    this.events?.push(`run:${this.userIds.length}`);

    const outcome = this.outcomes[this.userIds.length - 1];
    this.events?.push('release');

    if (outcome === 'success') {
      return { status: 'committed', value: undefined as T };
    }

    throw outcome;
  }
}

function sqlStateError(code: string): Error {
  return Object.assign(new Error(`forced SQLSTATE ${code}`), { code });
}

function eligibleFailure(
  overrides: Partial<ConstructorParameters<typeof AccountTransactionError>[0]> = {},
): AccountTransactionError {
  return new AccountTransactionError({
    stage: 'work',
    commitOutcome: 'not-attempted',
    clientDisposition: 'released',
    cause: sqlStateError('40001'),
    transientFailure: 'serialization-failure',
    ...overrides,
  });
}

function createRunner(
  outcomes: readonly unknown[],
  events?: string[],
  logger = new RecordingLogger(),
): {
  readonly retry: RetryingSubmitOrderRunner;
  readonly runner: ScriptedRunner;
  readonly waits: ReturnType<typeof vi.fn>;
  readonly logger: RecordingLogger;
} {
  const runner = new ScriptedRunner(outcomes, events);
  const waits = vi.fn(async (milliseconds: number): Promise<void> => {
    events?.push(`wait:${milliseconds}`);
  });
  const retry = new RetryingSubmitOrderRunner(runner, waits, logger);

  return { retry, runner, waits, logger };
}

describe('RetryingSubmitOrderRunner', () => {
  it('commits the initial attempt without waiting', async () => {
    const { retry, runner, waits } = createRunner(['success']);

    await expect(
      retry.run(USER_ID, async () => 'value'),
    ).resolves.toEqual({ status: 'committed', value: undefined });
    expect(runner.userIds).toEqual([USER_ID]);
    expect(waits).not.toHaveBeenCalled();
  });

  it('recovers after one eligible transient failure with a single 50 ms wait', async () => {
    const outcomes = [eligibleFailure(), 'success'];
    const { retry, runner, waits, logger } = createRunner(outcomes);

    await expect(
      retry.run(USER_ID, async () => 'value'),
    ).resolves.toEqual({ status: 'committed', value: undefined });

    expect(runner.userIds).toEqual([USER_ID, USER_ID]);
    expect(waits.mock.calls.map(([milliseconds]) => milliseconds)).toEqual([
      ...DELAYS,
    ]);
    expect(logger.events()).toEqual(['orders.retry.scheduled']);
    expect(logger.entries[0]?.level).toBe('warn');
    expect(logger.entries[0]?.fields).toMatchObject({
      accountUserId: USER_ID,
      attempt: 2,
      delayMs: 50,
      stage: 'work',
      commitOutcome: 'not-attempted',
      code: '40001',
    });
    expect(JSON.stringify(logger.entries)).not.toContain('idempotency');
    expect(runner.works.every((work) => work === runner.works[0])).toBe(true);
  });

  it('stops after two eligible failures even when a third attempt could succeed', async () => {
    const firstFailure = eligibleFailure();
    const secondFailure = eligibleFailure({
      cause: sqlStateError('40P01'),
      transientFailure: 'deadlock',
    });
    const { retry, runner, waits } = createRunner([
      firstFailure,
      secondFailure,
      'success',
    ]);

    await expect(retry.run(USER_ID, async () => 'value')).rejects.toBe(
      secondFailure,
    );
    expect(runner.userIds).toHaveLength(2);
    expect(waits.mock.calls.map(([milliseconds]) => milliseconds)).toEqual([
      50,
    ]);
  });

  it('releases the client before waiting for the next attempt', async () => {
    const events: string[] = [];
    const { retry } = createRunner([eligibleFailure(), 'success'], events);

    await retry.run(USER_ID, async () => 'value');

    expect(events).toEqual([
      'run:1',
      'release',
      'wait:50',
      'run:2',
      'release',
    ]);
  });

  it('stops immediately when a non-eligible failure follows an eligible one', async () => {
    const businessFailure = new SubmitOrderError('conflict');
    const { retry, runner, waits } = createRunner([
      eligibleFailure(),
      businessFailure,
    ]);

    await expect(retry.run(USER_ID, async () => 'value')).rejects.toBe(
      businessFailure,
    );
    expect(runner.userIds).toHaveLength(2);
    expect(waits).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['business error', new SubmitOrderError('conflict')],
    ['generic error', new Error('unexpected')],
    [
      'unique violation',
      eligibleFailure({ transientFailure: undefined, cause: sqlStateError('23505') }),
    ],
    [
      'connection failure',
      eligibleFailure({
        stage: 'connection',
        clientDisposition: 'not-acquired',
      }),
    ],
    ['BEGIN failure', eligibleFailure({ stage: 'begin' })],
    [
      'uncertain COMMIT',
      eligibleFailure({
        stage: 'commit',
        commitOutcome: 'uncertain',
        clientDisposition: 'discarded',
      }),
    ],
    [
      'confirmed COMMIT with release failure',
      (() => {
        const error = eligibleFailure({
          stage: 'release',
          commitOutcome: 'confirmed',
          clientDisposition: 'released',
        });
        error.markReleaseFailed(new Error('release failed'));

        return error;
      })(),
    ],
    [
      'rollback failure',
      eligibleFailure({
        clientDisposition: 'discarded',
        rollbackError: new Error('rollback failed'),
      }),
    ],
    [
      'release failure',
      (() => {
        const error = eligibleFailure();
        error.markReleaseFailed(new Error('release failed'));

        return error;
      })(),
    ],
  ])('does not retry %s', async (_label, failure) => {
    const { retry, runner, waits } = createRunner([failure]);

    await expect(retry.run(USER_ID, async () => 'value')).rejects.toBe(failure);
    expect(runner.userIds).toEqual([USER_ID]);
    expect(waits).not.toHaveBeenCalled();
  });
});
