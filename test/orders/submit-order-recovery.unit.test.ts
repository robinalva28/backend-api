import { describe, expect, it, vi } from 'vitest';
import type { InstrumentReader } from '../../src/instruments/application/ports/out/instrument-reader.js';
import { OrderReplayRecoveryService } from '../../src/orders/application/order-replay-recovery.service.js';
import { SubmitOrderService } from '../../src/orders/application/submit-order.service.js';
import { SubmitOrderError } from '../../src/orders/application/errors/submit-order.error.js';
import type { SubmitOrderRecovery } from '../../src/orders/application/ports/out/submit-order-recovery.port.js';
import type { SubmitOrderRecoveryInput } from '../../src/orders/application/ports/out/submit-order-recovery.port.js';
import type { SubmitOrderRecoveryOutcome } from '../../src/orders/application/ports/out/submit-order-recovery.port.js';
import type { PersistedOrderRepository } from '../../src/orders/application/ports/out/persisted-order.repository.js';
import type { PreparedOrderRepository } from '../../src/orders/application/ports/out/prepared-order.repository.js';
import type { OrderCancellationRepository } from '../../src/orders/application/ports/out/order-cancellation.repository.js';
import {
  buildOrderIntentMetadata,
} from '../../src/orders/domain/order-intent-metadata.js';
import {
  createOrderIntent,
  type OrderIntent,
  type OrderIntentInput,
} from '../../src/orders/domain/order-intent.js';
import { OrderIntentError } from '../../src/orders/domain/order-intent.error.js';
import type {
  PersistedOrder,
  PersistedOrderStatus,
} from '../../src/orders/domain/persisted-order.js';
import type { LatestQuoteRepository } from '../../src/quotes/application/ports/out/latest-quote.repository.js';
import type { AccountMovementRepository } from '../../src/resources/application/ports/out/account-movement.repository.js';
import { AccountTransactionError } from '../../src/transactions/application/errors/account-transaction.error.js';
import { RecordingLogger } from '../support/recording-logger.js';
import type {
  AccountTransactionContext,
  AccountTransactionResult,
  AccountTransactionRunner,
} from '../../src/transactions/application/ports/out/account-transaction.port.js';

const USER_ID = 6101;
const KEY = '55555555-5555-4555-8555-555555555555';
const INSTRUMENT_ID = 71;
const ORDER_ID = 811;
const FIXED_DATE = new Date('2026-10-29T18:30:45.123Z');

function intent(overrides: Partial<OrderIntentInput> = {}): OrderIntent {
  return createOrderIntent({
    instrumentId: INSTRUMENT_ID,
    side: 'BUY',
    type: 'LIMIT',
    size: '10',
    limitPrice: '10.10',
    ...overrides,
  });
}

function persistedOrder(
  orderIntent: OrderIntent,
  status: PersistedOrderStatus = 'NEW',
): PersistedOrder {
  return {
    id: ORDER_ID,
    userId: USER_ID,
    idempotencyKey: KEY,
    status,
    intentMetadata: buildOrderIntentMetadata(orderIntent),
  };
}

function uncertainCommit(
  overrides: Partial<ConstructorParameters<typeof AccountTransactionError>[0]> = {},
): AccountTransactionError {
  return new AccountTransactionError({
    stage: 'commit',
    commitOutcome: 'uncertain',
    clientDisposition: 'discarded',
    cause: new Error('response lost after COMMIT'),
    ...overrides,
  });
}

class FailingSubmitRunner implements AccountTransactionRunner {
  calls = 0;

  constructor(private readonly error: unknown) {}

  async run<T>(
    _userId: number,
    _work: (context: AccountTransactionContext) => Promise<T>,
  ): Promise<AccountTransactionResult<T>> {
    this.calls += 1;

    throw this.error;
  }
}

class RecordingRecovery implements SubmitOrderRecovery {
  readonly inputs: SubmitOrderRecoveryInput[] = [];

  constructor(
    private readonly outcome:
      | SubmitOrderRecoveryOutcome
      | { readonly error: unknown },
  ) {}

  async recover(
    input: SubmitOrderRecoveryInput,
  ): Promise<SubmitOrderRecoveryOutcome> {
    this.inputs.push(input);

    if ('error' in this.outcome) {
      throw this.outcome.error;
    }

    return this.outcome;
  }
}

function createSubmitService(
  runner: AccountTransactionRunner,
  recovery: SubmitOrderRecovery,
  logger = new RecordingLogger(),
): SubmitOrderService {
  return new SubmitOrderService(
    runner,
    { now: () => new Date(FIXED_DATE) },
    recovery,
    logger,
  );
}

describe('SubmitOrderService uncertain-COMMIT recovery', () => {
  it.each(['FILLED', 'NEW', 'REJECTED', 'CANCELLED'] as const)(
    'returns the recovered %s order as a replay',
    async (status) => {
      const orderIntent = intent();
      const order = persistedOrder(orderIntent, status);
      const recovery = new RecordingRecovery({
        status: 'recovered',
        order,
      });
      const runner = new FailingSubmitRunner(uncertainCommit());

      await expect(
        createSubmitService(runner, recovery).execute({
          userId: USER_ID,
          idempotencyKey: KEY,
          intent: orderIntent,
        }),
      ).resolves.toEqual({
        orderId: ORDER_ID,
        status,
        replayed: true,
      });
      expect(runner.calls).toBe(1);
      expect(recovery.inputs).toHaveLength(1);
    },
  );

  it('logs recovery success with the order id and without the idempotency key', async () => {
    const orderIntent = intent();
    const order = persistedOrder(orderIntent, 'CANCELLED');
    const recovery = new RecordingRecovery({ status: 'recovered', order });
    const logger = new RecordingLogger();

    await createSubmitService(
      new FailingSubmitRunner(uncertainCommit()),
      recovery,
      logger,
    ).execute({
      userId: USER_ID,
      idempotencyKey: KEY,
      intent: orderIntent,
    });

    expect(logger.entries).toEqual([
      {
        level: 'info',
        event: 'orders.recovery.recovered',
        fields: { orderId: ORDER_ID, orderStatus: 'CANCELLED' },
      },
    ]);
    expect(JSON.stringify(logger.entries)).not.toContain(KEY);
  });

  it('maps a different recovered intent to the approved conflict', async () => {
    const recovery = new RecordingRecovery({ status: 'conflict' });

    await expectSubmitError(
      createSubmitService(
        new FailingSubmitRunner(uncertainCommit()),
        recovery,
      ).execute({
        userId: USER_ID,
        idempotencyKey: KEY,
        intent: intent(),
      }),
      'conflict',
    );
    expect(recovery.inputs).toHaveLength(1);
  });

  it('maps an absent recovery result to the generic completion failure', async () => {
    const recovery = new RecordingRecovery({ status: 'unrecoverable' });

    await expectSubmitError(
      createSubmitService(
        new FailingSubmitRunner(uncertainCommit()),
        recovery,
      ).execute({
        userId: USER_ID,
        idempotencyKey: KEY,
        intent: intent(),
      }),
      'completion-failed',
    );
    expect(recovery.inputs).toHaveLength(1);
  });

  it('logs one definitive failure event when recovery throws', async () => {
    const failure = new AccountTransactionError({
      stage: 'connection',
      commitOutcome: 'not-attempted',
      clientDisposition: 'not-acquired',
      cause: Object.assign(new Error('connection failed'), {
        code: 'ECONNREFUSED',
      }),
    });
    const recovery = new RecordingRecovery({ error: failure });
    const logger = new RecordingLogger();

    await expectSubmitError(
      createSubmitService(
        new FailingSubmitRunner(uncertainCommit()),
        recovery,
        logger,
      ).execute({
        userId: USER_ID,
        idempotencyKey: KEY,
        intent: intent(),
      }),
      'completion-failed',
    );

    expect(logger.entries).toHaveLength(1);
    expect(logger.entries[0]).toMatchObject({
      level: 'error',
      event: 'orders.recovery.failed',
      fields: {
        code: 'ECONNREFUSED',
        stage: 'connection',
        commitOutcome: 'not-attempted',
      },
    });
    expect(JSON.stringify(logger.entries)).not.toContain(KEY);
  });

  it('logs one definitive failure event when recovery finds no order', async () => {
    const recovery = new RecordingRecovery({ status: 'unrecoverable' });
    const logger = new RecordingLogger();

    await expectSubmitError(
      createSubmitService(
        new FailingSubmitRunner(uncertainCommit()),
        recovery,
        logger,
      ).execute({
        userId: USER_ID,
        idempotencyKey: KEY,
        intent: intent(),
      }),
      'completion-failed',
    );

    expect(logger.events()).toEqual(['orders.recovery.failed']);
    expect(logger.entries[0]?.level).toBe('error');
  });

  it('stops after one recovery even when recovery fails transiently', async () => {
    const transientFailure = new AccountTransactionError({
      stage: 'work',
      commitOutcome: 'not-attempted',
      clientDisposition: 'released',
      cause: Object.assign(new Error('forced serialization failure'), {
        code: '40001',
      }),
      transientFailure: 'serialization-failure',
    });
    const recovery = new RecordingRecovery({ error: transientFailure });

    let caught: unknown;

    try {
      await createSubmitService(
        new FailingSubmitRunner(uncertainCommit()),
        recovery,
      ).execute({
        userId: USER_ID,
        idempotencyKey: KEY,
        intent: intent(),
      });
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(SubmitOrderError);
    expect(caught).toMatchObject({ code: 'completion-failed' });
    expect((caught as Error).cause).toBe(transientFailure);
    expect(recovery.inputs).toHaveLength(1);
  });

  it('stops after one recovery even when recovery reports another uncertain COMMIT', async () => {
    const secondUncertainCommit = uncertainCommit();
    const recovery = new RecordingRecovery({ error: secondUncertainCommit });

    let caught: unknown;

    try {
      await createSubmitService(
        new FailingSubmitRunner(uncertainCommit()),
        recovery,
      ).execute({
        userId: USER_ID,
        idempotencyKey: KEY,
        intent: intent(),
      });
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(SubmitOrderError);
    expect(caught).toMatchObject({ code: 'completion-failed' });
    expect((caught as Error).cause).toBe(secondUncertainCommit);
    expect(recovery.inputs).toHaveLength(1);
  });

  it('recovers after a rollback failure when the client was discarded', async () => {
    const order = persistedOrder(intent(), 'CANCELLED');
    const recovery = new RecordingRecovery({
      status: 'recovered',
      order,
    });
    const failedRollback = uncertainCommit({
      rollbackError: new Error('ROLLBACK failed after an uncertain COMMIT'),
    });

    await expect(
      createSubmitService(
        new FailingSubmitRunner(failedRollback),
        recovery,
      ).execute({
        userId: USER_ID,
        idempotencyKey: KEY,
        intent: intent(),
      }),
    ).resolves.toEqual({
      orderId: ORDER_ID,
      status: 'CANCELLED',
      replayed: true,
    });
    expect(recovery.inputs).toHaveLength(1);
  });

  it('uses the same user, UUID and canonical intent for recovery', async () => {
    const rawIntent: OrderIntent = {
      instrumentId: INSTRUMENT_ID,
      side: 'BUY',
      type: 'LIMIT',
      mode: 'size',
      size: '10',
      amount: null,
      limitPrice: '10.10',
    };
    const canonical = intent();
    const recovery = new RecordingRecovery({
      status: 'recovered',
      order: persistedOrder(canonical, 'NEW'),
    });

    await createSubmitService(
      new FailingSubmitRunner(uncertainCommit()),
      recovery,
    ).execute({
      userId: USER_ID,
      idempotencyKey: KEY,
      intent: rawIntent,
    });

    expect(recovery.inputs).toEqual([
      { userId: USER_ID, idempotencyKey: KEY, intent: canonical },
    ]);
  });

  it.each([
    [
      'a confirmed COMMIT release failure',
      new AccountTransactionError({
        stage: 'release',
        commitOutcome: 'confirmed',
        clientDisposition: 'unknown',
        cause: new Error('release failed'),
      }),
    ],
    [
      'an error before COMMIT',
      new AccountTransactionError({
        stage: 'work',
        commitOutcome: 'not-attempted',
        clientDisposition: 'released',
        cause: new Error('work failed'),
      }),
    ],
    [
      'an uncertain COMMIT without a credited discard',
      uncertainCommit({ clientDisposition: 'unknown' }),
    ],
    [
      'an uncertain COMMIT that only released the client',
      uncertainCommit({ clientDisposition: 'released' }),
    ],
    [
      'an uncertain COMMIT whose release failed',
      (() => {
        const error = uncertainCommit();
        error.markReleaseFailed(new Error('release failed'));

        return error;
      })(),
    ],
    ['a business error', new SubmitOrderError('conflict')],
    ['an unknown error', new Error('unexpected failure')],
  ])('does not start recovery for %s', async (_label, failure) => {
    const recovery = new RecordingRecovery({ status: 'unrecoverable' });
    const runner = new FailingSubmitRunner(failure);

    await expect(
      createSubmitService(runner, recovery).execute({
        userId: USER_ID,
        idempotencyKey: KEY,
        intent: intent(),
      }),
    ).rejects.toBe(failure);
    expect(recovery.inputs).toEqual([]);
  });
});

class ScriptedRecoveryRunner implements AccountTransactionRunner {
  readonly userIds: number[] = [];
  readonly events: string[] = [];

  constructor(
    private readonly context: AccountTransactionContext,
    private readonly options: {
      readonly accountExists?: boolean;
      readonly error?: unknown;
    } = {},
  ) {}

  async run<T>(
    userId: number,
    work: (context: AccountTransactionContext) => Promise<T>,
  ): Promise<AccountTransactionResult<T>> {
    this.userIds.push(userId);

    if (this.options.error !== undefined) {
      throw this.options.error;
    }

    if (this.options.accountExists === false) {
      return { status: 'account-not-found' };
    }

    const value = await work(this.context);
    this.events.push('commit');

    return { status: 'committed', value };
  }
}

interface RecoveryContextSpies {
  readonly findByKey: ReturnType<
    typeof vi.fn<PersistedOrderRepository['findByUserIdAndIdempotencyKey']>
  >;
  readonly findInstrument: ReturnType<typeof vi.fn<InstrumentReader['findById']>>;
  readonly findQuote: ReturnType<
    typeof vi.fn<LatestQuoteRepository['findLatestByInstrumentId']>
  >;
  readonly findMovements: ReturnType<
    typeof vi.fn<AccountMovementRepository['findByUserId']>
  >;
  readonly insert: ReturnType<typeof vi.fn<PreparedOrderRepository['insert']>>;
  readonly findCancellation: ReturnType<
    typeof vi.fn<OrderCancellationRepository['findByUserIdAndId']>
  >;
  readonly markCancelled: ReturnType<
    typeof vi.fn<OrderCancellationRepository['markCancelledIfNew']>
  >;
}

function recoveryContext(order: PersistedOrder | null): {
  readonly context: AccountTransactionContext;
  readonly spies: RecoveryContextSpies;
} {
  const findByKey = vi.fn<
    PersistedOrderRepository['findByUserIdAndIdempotencyKey']
  >();
  findByKey.mockResolvedValue(order);
  const findInstrument = vi.fn<InstrumentReader['findById']>();
  findInstrument.mockRejectedValue(new Error('recovery read an instrument'));
  const findQuote = vi.fn<LatestQuoteRepository['findLatestByInstrumentId']>();
  findQuote.mockRejectedValue(new Error('recovery read a quote'));
  const findMovements = vi.fn<AccountMovementRepository['findByUserId']>();
  findMovements.mockRejectedValue(new Error('recovery read resources'));
  const insert = vi.fn<PreparedOrderRepository['insert']>();
  insert.mockRejectedValue(new Error('recovery inserted an order'));
  const findCancellation = vi.fn<
    OrderCancellationRepository['findByUserIdAndId']
  >();
  findCancellation.mockRejectedValue(new Error('recovery read a cancellation'));
  const markCancelled = vi.fn<OrderCancellationRepository['markCancelledIfNew']>();
  markCancelled.mockRejectedValue(new Error('recovery cancelled an order'));

  return {
    context: {
      userId: USER_ID,
      instruments: { findById: findInstrument },
      accountMovements: { findByUserId: findMovements },
      latestQuotes: { findLatestByInstrumentId: findQuote },
      persistedOrders: { findByUserIdAndIdempotencyKey: findByKey },
      preparedOrders: { insert },
      orderCancellations: {
        findByUserIdAndId: findCancellation,
        markCancelledIfNew: markCancelled,
      },
    },
    spies: {
      findByKey,
      findInstrument,
      findQuote,
      findMovements,
      insert,
      findCancellation,
      markCancelled,
    },
  };
}

describe('OrderReplayRecoveryService', () => {
  it.each(['FILLED', 'NEW', 'REJECTED', 'CANCELLED'] as const)(
    'returns the stored %s order after committing the read transaction',
    async (status) => {
      const orderIntent = intent();
      const order = persistedOrder(orderIntent, status);
      const { context, spies } = recoveryContext(order);
      const runner = new ScriptedRecoveryRunner(context);

      await expect(
        new OrderReplayRecoveryService(runner).recover({
          userId: USER_ID,
          idempotencyKey: KEY,
          intent: orderIntent,
        }),
      ).resolves.toEqual({ status: 'recovered', order });
      expect(runner.userIds).toEqual([USER_ID]);
      expect(runner.events).toEqual(['commit']);
      expect(spies.findByKey).toHaveBeenCalledWith(USER_ID, KEY);
      expectNoBusinessAccess(spies);
    },
  );

  it('returns a conflict without writing or reading business data', async () => {
    const storedIntent = intent({ size: '11' });
    const { context, spies } = recoveryContext(
      persistedOrder(storedIntent, 'NEW'),
    );
    const runner = new ScriptedRecoveryRunner(context);

    await expect(
      new OrderReplayRecoveryService(runner).recover({
        userId: USER_ID,
        idempotencyKey: KEY,
        intent: intent({ size: '10' }),
      }),
    ).resolves.toEqual({ status: 'conflict' });
    expect(runner.events).toEqual(['commit']);
    expectNoBusinessAccess(spies);
  });

  it('commits an absent read and reports it as unrecoverable', async () => {
    const { context, spies } = recoveryContext(null);
    const runner = new ScriptedRecoveryRunner(context);

    await expect(
      new OrderReplayRecoveryService(runner).recover({
        userId: USER_ID,
        idempotencyKey: KEY,
        intent: intent(),
      }),
    ).resolves.toEqual({ status: 'unrecoverable' });
    expect(runner.events).toEqual(['commit']);
    expectNoBusinessAccess(spies);
  });

  it('reports a missing account as unrecoverable without running the read', async () => {
    const { context, spies } = recoveryContext(null);
    const runner = new ScriptedRecoveryRunner(context, {
      accountExists: false,
    });

    await expect(
      new OrderReplayRecoveryService(runner).recover({
        userId: USER_ID,
        idempotencyKey: KEY,
        intent: intent(),
      }),
    ).resolves.toEqual({ status: 'unrecoverable' });
    expect(runner.events).toEqual([]);
    expect(spies.findByKey).not.toHaveBeenCalled();
  });

  it.each([
    ['invalid metadata', { version: 1, parameters: {} }],
    ['an unknown metadata version', { version: 2, parameters: {} }],
  ])('propagates %s without writing', async (_label, metadata) => {
    const orderIntent = intent();
    const { context, spies } = recoveryContext({
      ...persistedOrder(orderIntent),
      intentMetadata: metadata,
    });
    const runner = new ScriptedRecoveryRunner(context);

    await expect(
      new OrderReplayRecoveryService(runner).recover({
        userId: USER_ID,
        idempotencyKey: KEY,
        intent: orderIntent,
      }),
    ).rejects.toBeInstanceOf(OrderIntentError);
    expectNoBusinessAccess(spies);
  });

  it('propagates a recovery transaction failure without a second attempt', async () => {
    const failure = new AccountTransactionError({
      stage: 'connection',
      commitOutcome: 'not-attempted',
      clientDisposition: 'not-acquired',
      cause: new Error('connection failed'),
    });
    const { context } = recoveryContext(null);
    const runner = new ScriptedRecoveryRunner(context, { error: failure });

    await expect(
      new OrderReplayRecoveryService(runner).recover({
        userId: USER_ID,
        idempotencyKey: KEY,
        intent: intent(),
      }),
    ).rejects.toBe(failure);
    expect(runner.userIds).toEqual([USER_ID]);
  });
});

function expectNoBusinessAccess(spies: RecoveryContextSpies): void {
  expect(spies.findInstrument).not.toHaveBeenCalled();
  expect(spies.findQuote).not.toHaveBeenCalled();
  expect(spies.findMovements).not.toHaveBeenCalled();
  expect(spies.insert).not.toHaveBeenCalled();
  expect(spies.findCancellation).not.toHaveBeenCalled();
  expect(spies.markCancelled).not.toHaveBeenCalled();
}

async function expectSubmitError(
  action: Promise<unknown>,
  code: string,
): Promise<void> {
  try {
    await action;
  } catch (error) {
    expect(error).toBeInstanceOf(SubmitOrderError);
    expect(error).toMatchObject({ code });

    return;
  }

  throw new Error(`Expected SubmitOrderError code ${code}.`);
}
