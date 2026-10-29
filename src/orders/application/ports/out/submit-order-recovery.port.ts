import type { OrderIntent } from '../../../domain/order-intent.js';
import type { PersistedOrder } from '../../../domain/persisted-order.js';

export interface SubmitOrderRecoveryInput {
  readonly userId: number;
  readonly idempotencyKey: string;
  readonly intent: OrderIntent;
}

/**
 * Result of the single read-only recovery query allowed after an uncertain
 * COMMIT. `unrecoverable` groups an absent account/order and any state that
 * cannot safely prove the original submission; it must never create another
 * order.
 */
export type SubmitOrderRecoveryOutcome =
  | { readonly status: 'recovered'; readonly order: PersistedOrder }
  | { readonly status: 'conflict' }
  | { readonly status: 'unrecoverable' };

export interface SubmitOrderRecovery {
  recover(input: SubmitOrderRecoveryInput): Promise<SubmitOrderRecoveryOutcome>;
}
