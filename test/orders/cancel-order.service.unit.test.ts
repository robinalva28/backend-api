import { describe, expect, it, vi } from 'vitest';
import { CancelOrderService } from '../../src/orders/application/cancel-order.service.js';
import { CancelOrderError } from '../../src/orders/application/errors/cancel-order.error.js';
import type { CancelOrderInput } from '../../src/orders/application/ports/in/cancel-order.use-case.js';
import type { OrderCancellationRepository } from '../../src/orders/application/ports/out/order-cancellation.repository.js';
import type { CancellableOrder } from '../../src/orders/domain/cancellable-order.js';
import type { PersistedOrderStatus } from '../../src/orders/domain/persisted-order.js';
import { AccountTransactionError } from '../../src/transactions/application/errors/account-transaction.error.js';
import type {
  AccountTransactionContext,
  AccountTransactionResult,
  AccountTransactionRunner,
} from '../../src/transactions/application/ports/out/account-transaction.port.js';

const USER_ID = 5601;
const ORDER_ID = 901;

interface CancellationSpies {
  readonly find: ReturnType<
    typeof vi.fn<OrderCancellationRepository['findByUserIdAndId']>
  >;
  readonly cancel: ReturnType<
    typeof vi.fn<OrderCancellationRepository['markCancelledIfNew']>
  >;
}

function createContext(
  order: CancellableOrder | null,
  options: { readonly transitioned?: boolean } = {},
): {
  readonly context: AccountTransactionContext;
  readonly spies: CancellationSpies;
} {
  const find = vi.fn<OrderCancellationRepository['findByUserIdAndId']>();
  find.mockResolvedValue(order);
  const cancel = vi.fn<OrderCancellationRepository['markCancelledIfNew']>();
  cancel.mockResolvedValue(options.transitioned ?? true);

  return {
    context: {
      userId: USER_ID,
      instruments: {
        findById: vi.fn(async () => null),
      },
      accountMovements: {
        findByUserId: vi.fn(async () => []),
      },
      latestQuotes: {
        findLatestByInstrumentId: vi.fn(async () => null),
      },
      persistedOrders: {
        findByUserIdAndIdempotencyKey: vi.fn(async () => null),
      },
      preparedOrders: {
        insert: vi.fn(async () => {
          throw new Error('Prepared orders are not used by cancellation.');
        }),
      },
      orderCancellations: {
        findByUserIdAndId: find,
        markCancelledIfNew: cancel,
      },
    },
    spies: { find, cancel },
  };
}

function cancellableOrder(
  status: PersistedOrderStatus = 'NEW',
): CancellableOrder {
  return { id: ORDER_ID, userId: USER_ID, status };
}

class FakeRunner implements AccountTransactionRunner {
  calls = 0;
  readonly userIds: number[] = [];

  constructor(
    private readonly context: AccountTransactionContext,
    private readonly accountExists = true,
  ) {}

  async run<T>(
    userId: number,
    work: (context: AccountTransactionContext) => Promise<T>,
  ): Promise<AccountTransactionResult<T>> {
    this.calls += 1;
    this.userIds.push(userId);

    if (!this.accountExists) {
      return { status: 'account-not-found' };
    }

    return { status: 'committed', value: await work(this.context) };
  }
}

class UncertainCommitRunner implements AccountTransactionRunner {
  workCalls = 0;

  constructor(private readonly context: AccountTransactionContext) {}

  async run<T>(
    _userId: number,
    work: (context: AccountTransactionContext) => Promise<T>,
  ): Promise<AccountTransactionResult<T>> {
    this.workCalls += 1;
    await work(this.context);

    throw new AccountTransactionError({
      stage: 'commit',
      commitOutcome: 'uncertain',
      clientDisposition: 'discarded',
      cause: new Error('connection lost during commit'),
    });
  }
}

function input(overrides: Partial<CancelOrderInput> = {}): CancelOrderInput {
  return { userId: USER_ID, orderId: ORDER_ID, ...overrides };
}

async function expectCancelOrderError(
  action: Promise<unknown>,
  code: string,
): Promise<void> {
  try {
    await action;
  } catch (error) {
    expect(error).toBeInstanceOf(CancelOrderError);
    expect(error).toMatchObject({ code });

    return;
  }

  throw new Error(`Expected CancelOrderError code ${code}.`);
}

describe('CancelOrderService', () => {
  it('reads the NEW order before the conditional transition and returns success', async () => {
    const { context, spies } = createContext(cancellableOrder('NEW'));
    const runner = new FakeRunner(context);
    const service = new CancelOrderService(runner);

    await expect(service.execute(input())).resolves.toEqual({
      orderId: ORDER_ID,
      status: 'CANCELLED',
    });

    expect(runner.calls).toBe(1);
    expect(runner.userIds).toEqual([USER_ID]);
    expect(spies.find).toHaveBeenCalledWith(USER_ID, ORDER_ID);
    expect(spies.cancel).toHaveBeenCalledWith(USER_ID, ORDER_ID);
    expect(spies.find.mock.invocationCallOrder[0]).toBeLessThan(
      spies.cancel.mock.invocationCallOrder[0] ?? 0,
    );
  });

  it('returns success for an already CANCELLED order without updating it', async () => {
    const { context, spies } = createContext(cancellableOrder('CANCELLED'));
    const service = new CancelOrderService(new FakeRunner(context));

    await expect(service.execute(input())).resolves.toEqual({
      orderId: ORDER_ID,
      status: 'CANCELLED',
    });

    expect(spies.find).toHaveBeenCalledTimes(1);
    expect(spies.cancel).not.toHaveBeenCalled();
  });

  it.each(['FILLED', 'REJECTED'] as const)(
    'returns a typed conflict for a %s order without updating it',
    async (status) => {
      const { context, spies } = createContext(cancellableOrder(status));
      const service = new CancelOrderService(new FakeRunner(context));

      await expectCancelOrderError(
        service.execute(input()),
        'order-not-cancellable',
      );

      expect(spies.find).toHaveBeenCalledTimes(1);
      expect(spies.cancel).not.toHaveBeenCalled();
    },
  );

  it('uses the same not-found result for a missing or foreign order', async () => {
    const { context, spies } = createContext(null);
    const service = new CancelOrderService(new FakeRunner(context));

    await expectCancelOrderError(
      service.execute(input({ orderId: 999_999 })),
      'order-not-found',
    );

    expect(spies.find).toHaveBeenCalledWith(USER_ID, 999_999);
    expect(spies.cancel).not.toHaveBeenCalled();
  });

  it('preserves the internal account-not-found distinction without running work', async () => {
    const { context, spies } = createContext(cancellableOrder('NEW'));
    const service = new CancelOrderService(new FakeRunner(context, false));

    await expectCancelOrderError(
      service.execute(input()),
      'account-not-found',
    );

    expect(spies.find).not.toHaveBeenCalled();
    expect(spies.cancel).not.toHaveBeenCalled();
  });

  it.each([
    { userId: 0, orderId: ORDER_ID },
    { userId: -1, orderId: ORDER_ID },
    { userId: 1.5, orderId: ORDER_ID },
    { userId: Number.NaN, orderId: ORDER_ID },
    { userId: USER_ID, orderId: 0 },
    { userId: USER_ID, orderId: -4 },
    { userId: USER_ID, orderId: 2.5 },
    { userId: USER_ID, orderId: Number.MAX_SAFE_INTEGER + 1 },
  ])(
    'rejects semantically invalid input %j before opening a transaction',
    async (overrides) => {
      const { context, spies } = createContext(cancellableOrder('NEW'));
      const runner = new FakeRunner(context);
      const service = new CancelOrderService(runner);

      await expectCancelOrderError(
        service.execute(input(overrides)),
        'invalid-input',
      );

      expect(runner.calls).toBe(0);
      expect(spies.find).not.toHaveBeenCalled();
      expect(spies.cancel).not.toHaveBeenCalled();
    },
  );

  it('fails without success when the conditional transition is not acknowledged', async () => {
    const { context, spies } = createContext(cancellableOrder('NEW'), {
      transitioned: false,
    });
    const service = new CancelOrderService(new FakeRunner(context));

    await expectCancelOrderError(
      service.execute(input()),
      'transition-not-acknowledged',
    );

    expect(spies.find).toHaveBeenCalledTimes(1);
    expect(spies.cancel).toHaveBeenCalledTimes(1);
  });

  it('does not return success when COMMIT is uncertain', async () => {
    const { context, spies } = createContext(cancellableOrder('NEW'));
    const runner = new UncertainCommitRunner(context);
    const service = new CancelOrderService(runner);

    await expect(service.execute(input())).rejects.toMatchObject({
      name: 'AccountTransactionError',
      stage: 'commit',
      commitOutcome: 'uncertain',
    });

    expect(runner.workCalls).toBe(1);
    expect(spies.cancel).toHaveBeenCalledTimes(1);
  });

  it('propagates a read failure instead of treating the order as absent', async () => {
    const { context, spies } = createContext(cancellableOrder('NEW'));
    const failure = new Error('read failed');
    spies.find.mockRejectedValueOnce(failure);
    const service = new CancelOrderService(new FakeRunner(context));

    await expect(service.execute(input())).rejects.toBe(failure);
    expect(spies.cancel).not.toHaveBeenCalled();
  });
});
