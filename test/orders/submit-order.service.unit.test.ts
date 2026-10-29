import { describe, expect, it, vi } from 'vitest';
import { Decimal } from 'decimal.js';
import type { InstrumentReader } from '../../src/instruments/application/ports/out/instrument-reader.js';
import type { LatestQuoteRepository } from '../../src/quotes/application/ports/out/latest-quote.repository.js';
import type { PersistedOrderRepository } from '../../src/orders/application/ports/out/persisted-order.repository.js';
import type { PreparedOrderRepository } from '../../src/orders/application/ports/out/prepared-order.repository.js';
import type { OrderCancellationRepository } from '../../src/orders/application/ports/out/order-cancellation.repository.js';
import type { AccountMovementRepository } from '../../src/resources/application/ports/out/account-movement.repository.js';
import { SubmitOrderService } from '../../src/orders/application/submit-order.service.js';
import { SubmitOrderError } from '../../src/orders/application/errors/submit-order.error.js';
import type { SubmitOrderInput } from '../../src/orders/application/ports/in/submit-order.use-case.js';
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
import type { PreparedOrder } from '../../src/orders/domain/prepared-order.js';
import type { AccountMovement } from '../../src/resources/domain/account-movement.js';
import { AccountTransactionError } from '../../src/transactions/application/errors/account-transaction.error.js';
import type {
  AccountTransactionContext,
  AccountTransactionResult,
  AccountTransactionRunner,
} from '../../src/transactions/application/ports/out/account-transaction.port.js';

const USER_ID = 5201;
const KEY = '22222222-2222-4222-8222-222222222222';
const INSTRUMENT_ID = 47;
const CASH_INSTRUMENT_ID = 66;
const FIXED_DATE = new Date('2026-10-28T18:30:45.123Z');
const FIXED_DATETIME = '2026-10-28T18:30:45.123';

interface ContextOptions {
  readonly order?: PersistedOrder | null;
  readonly instrument?: { readonly id: number; readonly type: string | null } | null;
  readonly quote?: {
    readonly id: number;
    readonly instrumentId: number;
    readonly date: string;
    readonly close: string | null;
    readonly previousClose: string | null;
  } | null;
  readonly movements?: readonly AccountMovement[];
}

interface ContextSpies {
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
}

function createContext(options: ContextOptions = {}): {
  readonly context: AccountTransactionContext;
  readonly spies: ContextSpies;
} {
  const findByKey = vi.fn<
    PersistedOrderRepository['findByUserIdAndIdempotencyKey']
  >();
  findByKey.mockResolvedValue(options.order ?? null);
  const findInstrument = vi.fn<InstrumentReader['findById']>();
  findInstrument.mockResolvedValue(
    options.instrument === undefined
      ? { id: INSTRUMENT_ID, type: 'ACCIONES' }
      : options.instrument,
  );
  const findQuote = vi.fn<
    LatestQuoteRepository['findLatestByInstrumentId']
  >();
  findQuote.mockResolvedValue(
    options.quote === undefined
      ? {
          id: 1,
          instrumentId: INSTRUMENT_ID,
          date: '2023-07-14',
          close: '10.00',
          previousClose: '9.00',
        }
      : options.quote,
  );
  const findMovements = vi.fn<AccountMovementRepository['findByUserId']>();
  findMovements.mockResolvedValue(options.movements ?? []);
  const insert = vi.fn<PreparedOrderRepository['insert']>();
  insert.mockImplementation(
    async (prepared: PreparedOrder): Promise<PersistedOrder> => ({
      id: 99,
      userId: USER_ID,
      idempotencyKey: prepared.idempotencyKey,
      status: prepared.status,
      intentMetadata: buildOrderIntentMetadata(prepared.intent),
    }),
  );

  return {
    context: {
      userId: USER_ID,
      instruments: { findById: findInstrument },
      accountMovements: { findByUserId: findMovements },
      latestQuotes: { findLatestByInstrumentId: findQuote },
      persistedOrders: { findByUserIdAndIdempotencyKey: findByKey },
      preparedOrders: { insert },
      orderCancellations: cancellationRepository(),
    },
    spies: {
      findByKey,
      findInstrument,
      findQuote,
      findMovements,
      insert,
    },
  };
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
  constructor(private readonly context: AccountTransactionContext) {}

  async run<T>(
    _userId: number,
    work: (context: AccountTransactionContext) => Promise<T>,
  ): Promise<AccountTransactionResult<T>> {
    await work(this.context);

    throw new AccountTransactionError({
      stage: 'commit',
      commitOutcome: 'uncertain',
      clientDisposition: 'discarded',
      cause: new Error('connection lost during commit'),
    });
  }
}

function sizeIntent(overrides: Partial<OrderIntentInput> = {}): OrderIntent {
  return createOrderIntent({
    instrumentId: INSTRUMENT_ID,
    side: 'BUY',
    type: 'MARKET',
    size: '10',
    ...overrides,
  });
}

function limitIntent(overrides: Partial<OrderIntentInput> = {}): OrderIntent {
  return createOrderIntent({
    instrumentId: INSTRUMENT_ID,
    side: 'BUY',
    type: 'LIMIT',
    size: '10',
    limitPrice: '10.10',
    ...overrides,
  });
}

function amountIntent(overrides: Partial<OrderIntentInput> = {}): OrderIntent {
  return createOrderIntent({
    instrumentId: INSTRUMENT_ID,
    side: 'BUY',
    type: 'MARKET',
    amount: '1000',
    ...overrides,
  });
}

function persistedOrder(
  intent: OrderIntent,
  status: PersistedOrderStatus = 'NEW',
): PersistedOrder {
  return {
    id: 77,
    userId: USER_ID,
    idempotencyKey: KEY,
    status,
    intentMetadata: buildOrderIntentMetadata(intent),
  };
}

function cancellationRepository(): OrderCancellationRepository {
  return {
    findByUserIdAndId: vi.fn(async () => null),
    markCancelledIfNew: vi.fn(async () => false),
  };
}

function cashIn(size: number): AccountMovement {
  return {
    id: 1,
    instrumentId: CASH_INSTRUMENT_ID,
    side: 'CASH_IN',
    status: 'FILLED',
    size,
    price: null,
  };
}

function buyFilled(size: number, price: string): AccountMovement {
  return {
    id: 2,
    instrumentId: INSTRUMENT_ID,
    side: 'BUY',
    status: 'FILLED',
    size,
    price,
  };
}

function buyNew(size: number, price: string): AccountMovement {
  return {
    id: 3,
    instrumentId: INSTRUMENT_ID,
    side: 'BUY',
    status: 'NEW',
    size,
    price,
  };
}

function sellNew(size: number, price: string): AccountMovement {
  return {
    id: 4,
    instrumentId: INSTRUMENT_ID,
    side: 'SELL',
    status: 'NEW',
    size,
    price,
  };
}

function createService(
  context: AccountTransactionContext,
  options: { readonly accountExists?: boolean; readonly runner?: AccountTransactionRunner } = {},
): {
  readonly service: SubmitOrderService;
  readonly runnerCalls: () => number;
  readonly now: ReturnType<typeof vi.fn>;
} {
  const runner =
    options.runner ??
    new FakeRunner(context, options.accountExists ?? true);
  const now = vi.fn(() => new Date(FIXED_DATE));
  const service = new SubmitOrderService(runner, { now });

  return {
    service,
    runnerCalls: () => (runner instanceof FakeRunner ? runner.calls : 0),
    now,
  };
}

function input(intent: OrderIntent, overrides: Partial<SubmitOrderInput> = {}): SubmitOrderInput {
  return {
    userId: USER_ID,
    idempotencyKey: KEY,
    intent,
    ...overrides,
  };
}

async function expectSubmitOrderError(
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

describe('SubmitOrderService', () => {
  it.each(['NEW', 'FILLED', 'REJECTED', 'CANCELLED'] as const)(
    'returns the persisted order in %s state without new decisions or effects',
    async (status) => {
      const intent = sizeIntent();
      const order = persistedOrder(intent, status);
      const { context, spies } = createContext({ order });
      const { service, runnerCalls, now } = createService(context);

      await expect(service.execute(input(intent))).resolves.toEqual({
        orderId: order.id,
        status,
        replayed: true,
      });
      expect(runnerCalls()).toBe(1);
      expect(spies.findByKey).toHaveBeenCalledWith(USER_ID, KEY);
      expect(spies.findInstrument).not.toHaveBeenCalled();
      expect(spies.findQuote).not.toHaveBeenCalled();
      expect(spies.findMovements).not.toHaveBeenCalled();
      expect(spies.insert).not.toHaveBeenCalled();
      expect(now).not.toHaveBeenCalled();
    },
  );

  it('returns a typed conflict for the same key with a different intent', async () => {
    const stored = sizeIntent({ size: '10' });
    const requested = sizeIntent({ size: '11' });
    const { context, spies } = createContext({
      order: persistedOrder(stored),
    });
    const { service, now } = createService(context);

    await expectSubmitOrderError(
      service.execute(input(requested)),
      'conflict',
    );

    expect(spies.findInstrument).not.toHaveBeenCalled();
    expect(spies.findQuote).not.toHaveBeenCalled();
    expect(spies.findMovements).not.toHaveBeenCalled();
    expect(spies.insert).not.toHaveBeenCalled();
    expect(now).not.toHaveBeenCalled();
  });

  it('propagates invalid persisted metadata instead of treating it as absent', async () => {
    const intent = sizeIntent();
    const { context, spies } = createContext({
      order: {
        ...persistedOrder(intent),
        intentMetadata: { version: 1, parameters: {} },
      },
    });
    const { service, now } = createService(context);

    await expect(service.execute(input(intent))).rejects.toBeInstanceOf(
      OrderIntentError,
    );
    expect(spies.findInstrument).not.toHaveBeenCalled();
    expect(spies.findQuote).not.toHaveBeenCalled();
    expect(spies.insert).not.toHaveBeenCalled();
    expect(now).not.toHaveBeenCalled();
  });

  it('accepts omitted currency and explicit ARS', async () => {
    for (const currency of [undefined, 'ARS']) {
      const intent = sizeIntent({ size: '1' });
      const { context, spies } = createContext({
        movements: [cashIn(1000)],
      });
      const { service } = createService(context);

      await expect(
        service.execute(input(intent, { currency })),
      ).resolves.toMatchObject({ status: 'FILLED', replayed: false });
      expect(spies.insert).toHaveBeenCalledTimes(1);
    }
  });

  it('rejects any other currency before starting a transaction or converting amounts', async () => {
    const intent = amountIntent();
    const { context, spies } = createContext();
    const { service, runnerCalls, now } = createService(context);

    await expectSubmitOrderError(
      service.execute(input(intent, { currency: 'USD' })),
      'unsupported-currency',
    );

    expect(runnerCalls()).toBe(0);
    expect(spies.findByKey).not.toHaveBeenCalled();
    expect(spies.findMovements).not.toHaveBeenCalled();
    expect(spies.insert).not.toHaveBeenCalled();
    expect(now).not.toHaveBeenCalled();
  });

  it('rejects a missing instrument without writing an order', async () => {
    const intent = sizeIntent();
    const { context, spies } = createContext({ instrument: null });
    const { service, now } = createService(context);

    await expectSubmitOrderError(
      service.execute(input(intent)),
      'instrument-not-found',
    );

    expect(spies.findQuote).not.toHaveBeenCalled();
    expect(spies.findMovements).not.toHaveBeenCalled();
    expect(spies.insert).not.toHaveBeenCalled();
    expect(now).not.toHaveBeenCalled();
  });

  it.each(['MONEDA', 'BONO', null])(
    'rejects a non-tradable instrument type %p without writing an order',
    async (type) => {
      const intent = sizeIntent();
      const { context, spies } = createContext({
        instrument: { id: INSTRUMENT_ID, type },
      });
      const { service, now } = createService(context);

      await expectSubmitOrderError(
        service.execute(input(intent)),
        'instrument-not-tradable',
      );

      expect(spies.findQuote).not.toHaveBeenCalled();
      expect(spies.findMovements).not.toHaveBeenCalled();
      expect(spies.insert).not.toHaveBeenCalled();
      expect(now).not.toHaveBeenCalled();
    },
  );

  it('uses the original LIMIT price without reading a quote', async () => {
    const intent = limitIntent({ size: '5', limitPrice: '10.10' });
    const { context, spies } = createContext({
      movements: [cashIn(1000)],
    });
    const { service, now } = createService(context);

    await expect(service.execute(input(intent))).resolves.toMatchObject({
      status: 'NEW',
      replayed: false,
    });
    expect(spies.findQuote).not.toHaveBeenCalled();
    expect(spies.findMovements).toHaveBeenCalledTimes(1);
    expect(spies.insert).toHaveBeenCalledWith(
      expect.objectContaining({
        intent,
        size: 5,
        price: '10.1',
        status: 'NEW',
        datetime: FIXED_DATETIME,
      }),
    );
    expect(now).toHaveBeenCalledTimes(1);
  });

  it('uses the latest market close for MARKET and executes with resources', async () => {
    const intent = sizeIntent({ size: '5' });
    const { context, spies } = createContext({
      quote: {
        id: 9,
        instrumentId: INSTRUMENT_ID,
        date: '2023-07-14',
        close: '20.50',
        previousClose: '19.00',
      },
      movements: [cashIn(1000)],
    });
    const { service } = createService(context);

    await expect(service.execute(input(intent))).resolves.toMatchObject({
      status: 'FILLED',
      replayed: false,
    });
    expect(spies.findQuote).toHaveBeenCalledWith(INSTRUMENT_ID);
    expect(spies.insert).toHaveBeenCalledWith(
      expect.objectContaining({
        size: 5,
        price: '20.5',
        status: 'FILLED',
      }),
    );
  });

  it('assigns the server date only after replay resolution and business reads', async () => {
    const events: string[] = [];
    const intent = sizeIntent({ size: '1' });
    const { context, spies } = createContext();
    spies.findByKey.mockImplementation(async () => {
      events.push('replay');
      return null;
    });
    spies.findInstrument.mockImplementation(async () => {
      events.push('instrument');
      return { id: INSTRUMENT_ID, type: 'ACCIONES' };
    });
    spies.findQuote.mockImplementation(async () => {
      events.push('quote');
      return {
        id: 9,
        instrumentId: INSTRUMENT_ID,
        date: '2023-07-14',
        close: '10',
        previousClose: '10',
      };
    });
    spies.findMovements.mockImplementation(async () => {
      events.push('resources');
      return [cashIn(1000)];
    });
    spies.insert.mockImplementation(async (prepared: PreparedOrder) => {
      events.push('insert');
      return {
        id: 99,
        userId: USER_ID,
        idempotencyKey: prepared.idempotencyKey,
        status: prepared.status,
        intentMetadata: buildOrderIntentMetadata(prepared.intent),
      };
    });
    const now = vi.fn(() => {
      events.push('clock');
      return new Date(FIXED_DATE);
    });
    const service = new SubmitOrderService(new FakeRunner(context), { now });

    await service.execute(input(intent));

    expect(events).toEqual([
      'replay',
      'instrument',
      'quote',
      'resources',
      'clock',
      'insert',
    ]);
  });

  it('does not require previousClose for MARKET pricing', async () => {
    const intent = sizeIntent({ size: '1' });
    const { context } = createContext({
      quote: {
        id: 9,
        instrumentId: INSTRUMENT_ID,
        date: '2023-07-14',
        close: '20.50',
        previousClose: null,
      },
      movements: [cashIn(1000)],
    });
    const { service } = createService(context);

    await expect(service.execute(input(intent))).resolves.toMatchObject({
      status: 'FILLED',
    });
  });

  it('fails a new MARKET without usable quote, without fallback or persistence', async () => {
    const intent = sizeIntent();
    const absent = createContext({ quote: null });
    const absentService = createService(absent.context);
    await expectSubmitOrderError(
      absentService.service.execute(input(intent)),
      'quote-unavailable',
    );
    expect(absent.spies.findQuote).toHaveBeenCalledTimes(1);
    expect(absent.spies.findMovements).not.toHaveBeenCalled();
    expect(absent.spies.insert).not.toHaveBeenCalled();
    expect(absentService.now).not.toHaveBeenCalled();

    for (const close of [null, '', '0', '-1', 'NaN', 'Infinity']) {
      const invalid = createContext({
        quote: {
          id: 9,
          instrumentId: INSTRUMENT_ID,
          date: '2023-07-14',
          close,
          previousClose: '19.00',
        },
      });
      const { service, now } = createService(invalid.context);

      await expectSubmitOrderError(
        service.execute(input(intent)),
        'quote-invalid',
      );
      expect(invalid.spies.findQuote).toHaveBeenCalledTimes(1);
      expect(invalid.spies.findMovements).not.toHaveBeenCalled();
      expect(invalid.spies.insert).not.toHaveBeenCalled();
      expect(now).not.toHaveBeenCalled();
    }
  });

  it('converts an amount with the exact floor and preserves the original amount', async () => {
    const intent = amountIntent({ amount: '1.00' });
    const { context, spies } = createContext({
      quote: {
        id: 9,
        instrumentId: INSTRUMENT_ID,
        date: '2023-07-14',
        close: '0.30',
        previousClose: '0.30',
      },
      movements: [cashIn(1000)],
    });
    const { service } = createService(context);

    await expect(service.execute(input(intent))).resolves.toMatchObject({
      status: 'FILLED',
      replayed: false,
    });
    expect(spies.insert).toHaveBeenCalledWith(
      expect.objectContaining({
        intent,
        size: 3,
        price: '0.3',
        status: 'FILLED',
      }),
    );
    expect(buildOrderIntentMetadata(intent)).toMatchObject({
      parameters: { mode: 'amount', amount: '1' },
    });
  });

  it('rejects zero and non-representable quantities before reading resources or writing', async () => {
    const zero = createContext({
      quote: {
        id: 9,
        instrumentId: INSTRUMENT_ID,
        date: '2023-07-14',
        close: '10',
        previousClose: '10',
      },
    });
    const zeroService = createService(zero.context);

    await expectSubmitOrderError(
      zeroService.service.execute(input(amountIntent({ amount: '0.01' }))),
      'quantity-not-representable',
    );
    expect(zero.spies.findMovements).not.toHaveBeenCalled();
    expect(zero.spies.insert).not.toHaveBeenCalled();
    expect(zeroService.now).not.toHaveBeenCalled();

    const oversized = createContext({
      quote: {
        id: 9,
        instrumentId: INSTRUMENT_ID,
        date: '2023-07-14',
        close: '1',
        previousClose: '1',
      },
    });
    const oversizedService = createService(oversized.context);

    await expectSubmitOrderError(
      oversizedService.service.execute(
        input(sizeIntent({ size: '2147483648' })),
      ),
      'quantity-not-representable',
    );
    expect(oversized.spies.findMovements).not.toHaveBeenCalled();
    expect(oversized.spies.insert).not.toHaveBeenCalled();
    expect(oversizedService.now).not.toHaveBeenCalled();
  });

  it('persists an insufficient BUY as REJECTED without reducing its quantity', async () => {
    const intent = sizeIntent({ size: '10' });
    const { context, spies } = createContext({
      quote: {
        id: 9,
        instrumentId: INSTRUMENT_ID,
        date: '2023-07-14',
        close: '10.01',
        previousClose: '10.00',
      },
      movements: [cashIn(100)],
    });
    const { service } = createService(context);

    await expect(service.execute(input(intent))).resolves.toMatchObject({
      status: 'REJECTED',
      replayed: false,
    });
    expect(spies.insert).toHaveBeenCalledWith(
      expect.objectContaining({
        size: 10,
        price: '10.01',
        status: 'REJECTED',
      }),
    );
  });

  it('treats available cash equal to the cost as sufficient', async () => {
    const intent = sizeIntent({ size: '10' });
    const { context, spies } = createContext({
      quote: {
        id: 9,
        instrumentId: INSTRUMENT_ID,
        date: '2023-07-14',
        close: '10',
        previousClose: '10',
      },
      movements: [cashIn(100)],
    });
    const { service } = createService(context);

    await expect(service.execute(input(intent))).resolves.toMatchObject({
      status: 'FILLED',
    });
    expect(spies.insert).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'FILLED', size: 10 }),
    );
  });

  it('uses available cash after existing NEW BUY reserves', async () => {
    const intent = sizeIntent({ size: '5' });
    const { context, spies } = createContext({
      quote: {
        id: 9,
        instrumentId: INSTRUMENT_ID,
        date: '2023-07-14',
        close: '100',
        previousClose: '100',
      },
      movements: [cashIn(1000), buyNew(7, '100')],
    });
    const { service } = createService(context);

    await expect(service.execute(input(intent))).resolves.toMatchObject({
      status: 'REJECTED',
    });
    expect(spies.insert).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'REJECTED', size: 5 }),
    );
  });

  it('uses available shares after NEW SELL reserves and does not reduce the quantity', async () => {
    const sufficient = createContext({
      quote: {
        id: 9,
        instrumentId: INSTRUMENT_ID,
        date: '2023-07-14',
        close: '10',
        previousClose: '10',
      },
      movements: [buyFilled(10, '10'), sellNew(6, '10')],
    });
    const sufficientService = createService(sufficient.context);
    await expect(
      sufficientService.service.execute(
        input(sizeIntent({ side: 'SELL', size: '4' })),
      ),
    ).resolves.toMatchObject({ status: 'FILLED' });

    const insufficient = createContext({
      quote: {
        id: 9,
        instrumentId: INSTRUMENT_ID,
        date: '2023-07-14',
        close: '10',
        previousClose: '10',
      },
      movements: [buyFilled(10, '10'), sellNew(6, '10')],
    });
    const insufficientService = createService(insufficient.context);
    await expect(
      insufficientService.service.execute(
        input(sizeIntent({ side: 'SELL', size: '5' })),
      ),
    ).resolves.toMatchObject({ status: 'REJECTED' });
    expect(insufficient.spies.insert).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'REJECTED', size: 5 }),
    );
  });

  it('applies LIMIT reservations without execution effects', async () => {
    const intent = limitIntent({ side: 'SELL', size: '4', limitPrice: '12.34' });
    const { context, spies } = createContext({
      movements: [buyFilled(10, '10')],
    });
    const { service } = createService(context);

    await expect(service.execute(input(intent))).resolves.toMatchObject({
      status: 'NEW',
    });
    expect(spies.findQuote).not.toHaveBeenCalled();
    expect(spies.insert).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'NEW', size: 4, price: '12.34' }),
    );
  });

  it('does not change the global Decimal configuration', async () => {
    const before = {
      precision: Decimal.precision,
      rounding: Decimal.rounding,
      toExpNeg: Decimal.toExpNeg,
      toExpPos: Decimal.toExpPos,
    };
    const intent = amountIntent({ amount: '1000' });
    const { context } = createContext({
      quote: {
        id: 9,
        instrumentId: INSTRUMENT_ID,
        date: '2023-07-14',
        close: '300',
        previousClose: '300',
      },
      movements: [cashIn(10_000)],
    });
    const { service } = createService(context);

    await service.execute(input(intent));

    expect({
      precision: Decimal.precision,
      rounding: Decimal.rounding,
      toExpNeg: Decimal.toExpNeg,
      toExpPos: Decimal.toExpPos,
    }).toEqual(before);
  });

  it('maps a missing account to a typed internal error without running work', async () => {
    const intent = sizeIntent();
    const { context, spies } = createContext();
    const { service } = createService(context, { accountExists: false });

    await expectSubmitOrderError(
      service.execute(input(intent)),
      'account-not-found',
    );

    expect(spies.findByKey).not.toHaveBeenCalled();
    expect(spies.insert).not.toHaveBeenCalled();
  });

  it('does not emit success or claim rollback when COMMIT is uncertain', async () => {
    const intent = sizeIntent();
    const { context, spies } = createContext({
      movements: [cashIn(1000)],
    });
    const { service } = createService(context, {
      runner: new UncertainCommitRunner(context),
    });

    await expect(service.execute(input(intent))).rejects.toMatchObject({
      stage: 'commit',
      commitOutcome: 'uncertain',
      clientDisposition: 'discarded',
    });
    expect(spies.insert).toHaveBeenCalledTimes(1);
  });
});
