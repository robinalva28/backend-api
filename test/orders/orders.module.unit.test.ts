import { ConfigModule } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import type { TestingModule } from '@nestjs/testing';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { CancelOrderUseCase } from '../../src/orders/application/ports/in/cancel-order.use-case.js';
import type { SubmitOrderUseCase } from '../../src/orders/application/ports/in/submit-order.use-case.js';
import { createOrderIntent } from '../../src/orders/domain/order-intent.js';
import { buildOrderIntentMetadata } from '../../src/orders/domain/order-intent-metadata.js';
import type { PersistedOrder } from '../../src/orders/domain/persisted-order.js';
import { OrdersModule } from '../../src/orders/orders.module.js';
import {
  CANCEL_ORDER_USE_CASE,
  SUBMIT_ORDER_USE_CASE,
} from '../../src/orders/orders.tokens.js';
import { AccountTransactionError } from '../../src/transactions/application/errors/account-transaction.error.js';
import type {
  AccountTransactionContext,
  AccountTransactionResult,
  AccountTransactionRunner,
} from '../../src/transactions/application/ports/out/account-transaction.port.js';
import { ACCOUNT_TRANSACTION_RUNNER } from '../../src/transactions/transactions.tokens.js';

const USER_ID = 5901;
const ORDER_ID = 701;
const KEY = '33333333-3333-4333-8333-333333333333';

class ScriptedRunner implements AccountTransactionRunner {
  calls = 0;
  transientFailures = 0;
  uncertainCommitOnce = false;
  recoveryOrder: PersistedOrder | undefined;

  async run<T>(
    userId: number,
    work: (context: AccountTransactionContext) => Promise<T>,
  ): Promise<AccountTransactionResult<T>> {
    this.calls += 1;

    if (this.uncertainCommitOnce) {
      this.uncertainCommitOnce = false;
      throw new AccountTransactionError({
        stage: 'commit',
        commitOutcome: 'uncertain',
        clientDisposition: 'discarded',
        cause: new Error('response lost after COMMIT'),
      });
    }

    if (this.transientFailures > 0) {
      this.transientFailures -= 1;
      throw new AccountTransactionError({
        stage: 'work',
        commitOutcome: 'not-attempted',
        clientDisposition: 'released',
        cause: Object.assign(new Error('forced serialization failure'), {
          code: '40001',
        }),
        transientFailure: 'serialization-failure',
      });
    }

    if (this.recoveryOrder !== undefined) {
      const order = this.recoveryOrder;
      const value = await work(recoveryContext(userId, order));

      return { status: 'committed', value };
    }

    return {
      status: 'committed',
      value: {
        kind: 'replayed',
        order: {
          id: ORDER_ID,
          userId: USER_ID,
          idempotencyKey: KEY,
          status: 'NEW',
          intentMetadata: {
            version: 1,
            parameters: {},
          },
        },
      } as unknown as T,
    };
  }
}

function recoveryContext(
  userId: number,
  order: PersistedOrder,
): AccountTransactionContext {
  return {
    userId,
    instruments: {
      findById: async () => {
        throw new Error('Recovery read an instrument.');
      },
    },
    accountMovements: {
      findByUserId: async () => {
        throw new Error('Recovery read account movements.');
      },
    },
    latestQuotes: {
      findLatestByInstrumentId: async () => {
        throw new Error('Recovery read a quote.');
      },
    },
    persistedOrders: {
      findByUserIdAndIdempotencyKey: async () => order,
    },
    preparedOrders: {
      insert: async () => {
        throw new Error('Recovery inserted an order.');
      },
    },
    orderCancellations: {
      findByUserIdAndId: async () => {
        throw new Error('Recovery read a cancellation.');
      },
      markCancelledIfNew: async () => {
        throw new Error('Recovery cancelled an order.');
      },
    },
  };
}

describe('OrdersModule retry composition', () => {
  let moduleRef: TestingModule;
  let runner: ScriptedRunner;
  let submitOrder: SubmitOrderUseCase;
  let cancelOrder: CancelOrderUseCase;

  beforeAll(async () => {
    runner = new ScriptedRunner();
    moduleRef = await Test.createTestingModule({
      imports: [ConfigModule.forRoot({ isGlobal: true }), OrdersModule],
    })
      .overrideProvider(ACCOUNT_TRANSACTION_RUNNER)
      .useValue(runner)
      .compile();

    const submit = moduleRef.get<SubmitOrderUseCase>(SUBMIT_ORDER_USE_CASE);
    const cancel = moduleRef.get<CancelOrderUseCase>(CANCEL_ORDER_USE_CASE);
    submitOrder = submit;
    cancelOrder = cancel;
  });

  afterAll(async () => {
    await moduleRef.close();
    vi.useRealTimers();
  });

  it('retries eligible transient failures for submission only', async () => {
    runner.calls = 0;
    runner.transientFailures = 1;
    vi.useFakeTimers();

    try {
      const execution = submitOrder.execute({
        userId: USER_ID,
        idempotencyKey: KEY,
        intent: createOrderIntent({
          instrumentId: 47,
          side: 'BUY',
          type: 'MARKET',
          size: '1',
        }),
      });

      await vi.advanceTimersByTimeAsync(50);

      await expect(execution).resolves.toEqual({
        orderId: ORDER_ID,
        status: 'NEW',
        replayed: true,
      });
      expect(runner.calls).toBe(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it('keeps cancellation on the single-attempt runner', async () => {
    runner.calls = 0;
    runner.transientFailures = 1;

    await expect(
      cancelOrder.execute({ userId: USER_ID, orderId: ORDER_ID }),
    ).rejects.toBeInstanceOf(AccountTransactionError);
    expect(runner.calls).toBe(1);
  });

  it('composes one raw recovery query for submission after an uncertain COMMIT', async () => {
    const intent = createOrderIntent({
      instrumentId: 47,
      side: 'BUY',
      type: 'LIMIT',
      size: '3',
      limitPrice: '10.00',
    });
    const order: PersistedOrder = {
      id: ORDER_ID,
      userId: USER_ID,
      idempotencyKey: KEY,
      status: 'NEW',
      intentMetadata: buildOrderIntentMetadata(intent),
    };
    runner.calls = 0;
    runner.transientFailures = 0;
    runner.uncertainCommitOnce = true;
    runner.recoveryOrder = order;

    try {
      await expect(
        submitOrder.execute({
          userId: USER_ID,
          idempotencyKey: KEY,
          intent,
        }),
      ).resolves.toEqual({
        orderId: ORDER_ID,
        status: 'NEW',
        replayed: true,
      });
      expect(runner.calls).toBe(2);
    } finally {
      runner.uncertainCommitOnce = false;
      runner.recoveryOrder = undefined;
    }
  });

  it('does not recover cancellation from an uncertain COMMIT', async () => {
    runner.calls = 0;
    runner.transientFailures = 0;
    runner.uncertainCommitOnce = true;

    try {
      await expect(
        cancelOrder.execute({ userId: USER_ID, orderId: ORDER_ID }),
      ).rejects.toMatchObject({
        stage: 'commit',
        commitOutcome: 'uncertain',
      });
      expect(runner.calls).toBe(1);
    } finally {
      runner.uncertainCommitOnce = false;
    }
  });
});
