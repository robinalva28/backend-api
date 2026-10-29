import { Decimal } from 'decimal.js';
import { calculateAccountResources } from '../../resources/domain/calculate-account-resources.js';
import type { AccountResources } from '../../resources/domain/account-resources.js';
import type {
  AccountTransactionContext,
  AccountTransactionRunner,
} from '../../transactions/application/ports/out/account-transaction.port.js';
import { resolveOrderReplay } from './resolve-order-replay.js';
import { SubmitOrderError } from './errors/submit-order.error.js';
import type {
  SubmitOrderInput,
  SubmitOrderOutput,
  SubmitOrderUseCase,
} from './ports/in/submit-order.use-case.js';
import type { Clock } from './ports/out/clock.port.js';
import {
  createOrderIntent,
  type OrderIntent,
} from '../domain/order-intent.js';
import { OrderIntentError } from '../domain/order-intent.error.js';
import { readPositivePrice } from '../domain/order-price.js';
import { resolveOrderSize } from '../domain/order-quantity.js';
import { formatUtcTimestamp } from '../domain/order-time.js';
import { createPreparedOrder } from '../domain/prepared-order.js';
import type { PersistedOrder } from '../domain/persisted-order.js';

type SubmitWorkOutcome =
  | { readonly kind: 'replayed'; readonly order: PersistedOrder }
  | { readonly kind: 'created'; readonly order: PersistedOrder }
  | { readonly kind: 'conflict' }
  | { readonly kind: 'instrument-not-found' }
  | { readonly kind: 'instrument-not-tradable' }
  | { readonly kind: 'quote-unavailable' }
  | { readonly kind: 'quote-invalid' }
  | { readonly kind: 'quantity-not-representable' };

const TRADABLE_INSTRUMENT_TYPE = 'ACCIONES';
const SUPPORTED_CURRENCY = 'ARS';

/**
 * Internal order-submission use case for one transactional attempt. It
 * composes the existing account lock, replay resolution, market quote,
 * resource calculation and prepared-order writer. It does not expose HTTP or
 * infer recovery from an uncertain COMMIT. The submission composition applies
 * the bounded transient-failure retry policy around this single-attempt use
 * case; cancellation keeps using the runner directly.
 */
export class SubmitOrderService implements SubmitOrderUseCase {
  constructor(
    private readonly runner: AccountTransactionRunner,
    private readonly clock: Clock,
  ) {}

  async execute(input: SubmitOrderInput): Promise<SubmitOrderOutput> {
    assertSupportedCurrency(input.currency);
    const intent = canonicalizeIntent(input.intent);
    const result = await this.runner.run<SubmitWorkOutcome>(
      input.userId,
      (context) => this.submit(context, input.idempotencyKey, intent),
    );

    if (result.status === 'account-not-found') {
      throw new SubmitOrderError('account-not-found');
    }

    return toOutput(result.value);
  }

  private async submit(
    context: AccountTransactionContext,
    idempotencyKey: string,
    intent: OrderIntent,
  ): Promise<SubmitWorkOutcome> {
    const replay = await resolveOrderReplay(context.persistedOrders, {
      userId: context.userId,
      idempotencyKey,
      intent,
    });

    if (replay.outcome === 'match') {
      return { kind: 'replayed', order: replay.order };
    }

    if (replay.outcome === 'conflict') {
      return { kind: 'conflict' };
    }

    const instrument = await context.instruments.findById(intent.instrumentId);

    if (instrument === null) {
      return { kind: 'instrument-not-found' };
    }

    if (instrument.type !== TRADABLE_INSTRUMENT_TYPE) {
      return { kind: 'instrument-not-tradable' };
    }

    const price = await this.resolvePrice(context, intent);

    if (price.kind === 'unavailable') {
      return { kind: 'quote-unavailable' };
    }

    if (price.kind === 'invalid') {
      return { kind: 'quote-invalid' };
    }

    const size = resolveOrderSize(intent, price.value);

    if (size === null) {
      return { kind: 'quantity-not-representable' };
    }

    const resources = calculateAccountResources(
      await context.accountMovements.findByUserId(context.userId),
    );
    const hasResources = hasSufficientResources(
      intent.side,
      intent.instrumentId,
      size,
      price.value,
      resources,
    );
    const status = hasResources
      ? intent.type === 'MARKET'
        ? 'FILLED'
        : 'NEW'
      : 'REJECTED';
    const prepared = createPreparedOrder({
      idempotencyKey,
      intent,
      size,
      price: price.value,
      status,
      datetime: formatUtcTimestamp(this.clock.now()),
    });
    const order = await context.preparedOrders.insert(prepared);

    return { kind: 'created', order };
  }

  private async resolvePrice(
    context: AccountTransactionContext,
    intent: OrderIntent,
  ): Promise<
    | { readonly kind: 'available'; readonly value: string }
    | { readonly kind: 'unavailable' }
    | { readonly kind: 'invalid' }
  > {
    if (intent.type === 'LIMIT') {
      if (intent.limitPrice === null) {
        throw new OrderIntentError('invalid-limit-price');
      }

      return { kind: 'available', value: intent.limitPrice };
    }

    const quote = await context.latestQuotes.findLatestByInstrumentId(
      intent.instrumentId,
    );

    if (quote === null) {
      return { kind: 'unavailable' };
    }

    const close = readPositivePrice(quote.close);

    if (close === null) {
      return { kind: 'invalid' };
    }

    return { kind: 'available', value: close };
  }
}

function assertSupportedCurrency(currency: string | undefined): void {
  if (currency !== undefined && currency !== SUPPORTED_CURRENCY) {
    throw new SubmitOrderError('unsupported-currency');
  }
}

function canonicalizeIntent(intent: OrderIntent): OrderIntent {
  return createOrderIntent({
    instrumentId: intent.instrumentId,
    side: intent.side,
    type: intent.type,
    size: intent.size,
    amount: intent.amount,
    limitPrice: intent.limitPrice,
  });
}

function hasSufficientResources(
  side: OrderIntent['side'],
  instrumentId: number,
  size: number,
  price: string,
  resources: AccountResources,
): boolean {
  if (side === 'BUY') {
    const ExactDecimal = Decimal.clone({
      precision: Math.max(Decimal.precision, String(size).length + price.length + 2),
    });
    const requiredCash = new ExactDecimal(size).times(new ExactDecimal(price));

    return resources.availableCash.gte(requiredCash);
  }

  const instrument = resources.instruments.find(
    (candidate) => candidate.instrumentId === instrumentId,
  );

  return (instrument?.availableQuantity ?? 0) >= size;
}

function toOutput(outcome: SubmitWorkOutcome): SubmitOrderOutput {
  switch (outcome.kind) {
    case 'replayed':
      return {
        orderId: outcome.order.id,
        status: outcome.order.status,
        replayed: true,
      };
    case 'created':
      return {
        orderId: outcome.order.id,
        status: outcome.order.status,
        replayed: false,
      };
    case 'conflict':
      throw new SubmitOrderError('conflict');
    case 'instrument-not-found':
      throw new SubmitOrderError('instrument-not-found');
    case 'instrument-not-tradable':
      throw new SubmitOrderError('instrument-not-tradable');
    case 'quote-unavailable':
      throw new SubmitOrderError('quote-unavailable');
    case 'quote-invalid':
      throw new SubmitOrderError('quote-invalid');
    case 'quantity-not-representable':
      throw new SubmitOrderError('quantity-not-representable');
  }
}
