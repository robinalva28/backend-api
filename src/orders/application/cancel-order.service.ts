import type {
  AccountTransactionContext,
  AccountTransactionRunner,
} from '../../transactions/application/ports/out/account-transaction.port.js';
import { CancelOrderError } from './errors/cancel-order.error.js';
import type {
  CancelOrderInput,
  CancelOrderOutput,
  CancelOrderUseCase,
} from './ports/in/cancel-order.use-case.js';

type CancelWorkOutcome =
  | { readonly kind: 'cancelled' }
  | { readonly kind: 'order-not-found' }
  | { readonly kind: 'order-not-cancellable' };

/**
 * Internal cancellation use case for one transactional attempt. It reuses the
 * account transaction protocol: the account is locked before the order is
 * read, all statements share the same client and success is returned only
 * after a confirmed COMMIT. It does not expose HTTP, retry automatically or
 * infer the outcome of an uncertain COMMIT.
 */
export class CancelOrderService implements CancelOrderUseCase {
  constructor(private readonly runner: AccountTransactionRunner) {}

  async execute(input: CancelOrderInput): Promise<CancelOrderOutput> {
    assertValidInput(input);
    const result = await this.runner.run<CancelWorkOutcome>(
      input.userId,
      (context) => this.cancel(context, input.orderId),
    );

    if (result.status === 'account-not-found') {
      throw new CancelOrderError('account-not-found');
    }

    return toOutput(result.value, input.orderId);
  }

  private async cancel(
    context: AccountTransactionContext,
    orderId: number,
  ): Promise<CancelWorkOutcome> {
    const order = await context.orderCancellations.findByUserIdAndId(
      context.userId,
      orderId,
    );

    if (order === null) {
      return { kind: 'order-not-found' };
    }

    if (order.status === 'CANCELLED') {
      return { kind: 'cancelled' };
    }

    if (order.status !== 'NEW') {
      return { kind: 'order-not-cancellable' };
    }

    const transitioned = await context.orderCancellations.markCancelledIfNew(
      context.userId,
      orderId,
    );

    if (!transitioned) {
      // The accepted NEW read was not followed by an acknowledged transition.
      // Throwing inside the callback forces the runner to roll back instead of
      // reporting an unverified success.
      throw new CancelOrderError('transition-not-acknowledged');
    }

    return { kind: 'cancelled' };
  }
}

function assertValidInput(input: CancelOrderInput): void {
  if (
    !Number.isSafeInteger(input.userId) ||
    input.userId <= 0 ||
    !Number.isSafeInteger(input.orderId) ||
    input.orderId <= 0
  ) {
    throw new CancelOrderError('invalid-input');
  }
}

function toOutput(
  outcome: CancelWorkOutcome,
  orderId: number,
): CancelOrderOutput {
  switch (outcome.kind) {
    case 'cancelled':
      return { orderId, status: 'CANCELLED' };
    case 'order-not-found':
      throw new CancelOrderError('order-not-found');
    case 'order-not-cancellable':
      throw new CancelOrderError('order-not-cancellable');
  }
}
