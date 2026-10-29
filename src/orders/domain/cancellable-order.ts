import type { PersistedOrderStatus } from './persisted-order.js';

/**
 * Minimal persisted-order projection needed to decide a cancellation. It does
 * not require idempotency identity, metadata, price or any other order field,
 * so historical NEW rows remain cancellable.
 */
export interface CancellableOrder {
  readonly id: number;
  readonly userId: number;
  readonly status: PersistedOrderStatus;
}
