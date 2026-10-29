import type {
  AccountTransactionContext,
  AccountTransactionRunner,
} from '../../transactions/application/ports/out/account-transaction.port.js';
import type { PersistedOrder } from '../domain/persisted-order.js';
import { resolveOrderReplay } from './resolve-order-replay.js';
import type {
  SubmitOrderRecovery,
  SubmitOrderRecoveryInput,
  SubmitOrderRecoveryOutcome,
} from './ports/out/submit-order-recovery.port.js';

type RecoveryWorkOutcome =
  | { readonly kind: 'recovered'; readonly order: PersistedOrder }
  | { readonly kind: 'conflict' }
  | { readonly kind: 'unrecoverable' };

/**
 * Single recovery query used after the submission runner reports an uncertain
 * COMMIT and the previous client was discarded. It starts a fresh account
 * transaction, locks the same account before reading the same idempotency key
 * and resolves the stored intent with the existing replay rules. The callback
 * only reads; it never creates, updates or cancels an order, calculates a
 * quantity or reads resources or quotes. The runner COMMITs the read
 * transaction before this service reports any outcome.
 */
export class OrderReplayRecoveryService implements SubmitOrderRecovery {
  constructor(private readonly runner: AccountTransactionRunner) {}

  async recover(
    input: SubmitOrderRecoveryInput,
  ): Promise<SubmitOrderRecoveryOutcome> {
    const result = await this.runner.run<RecoveryWorkOutcome>(
      input.userId,
      (context) => this.resolve(context, input),
    );

    if (result.status === 'account-not-found') {
      return { status: 'unrecoverable' };
    }

    switch (result.value.kind) {
      case 'recovered':
        return { status: 'recovered', order: result.value.order };
      case 'conflict':
        return { status: 'conflict' };
      case 'unrecoverable':
        return { status: 'unrecoverable' };
    }
  }

  private async resolve(
    context: AccountTransactionContext,
    input: SubmitOrderRecoveryInput,
  ): Promise<RecoveryWorkOutcome> {
    const replay = await resolveOrderReplay(context.persistedOrders, {
      userId: input.userId,
      idempotencyKey: input.idempotencyKey,
      intent: input.intent,
    });

    switch (replay.outcome) {
      case 'match':
        return { kind: 'recovered', order: replay.order };
      case 'conflict':
        return { kind: 'conflict' };
      case 'absent':
        return { kind: 'unrecoverable' };
    }
  }
}
