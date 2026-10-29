import type { CancellableOrder } from '../../../domain/cancellable-order.js';

/**
 * Persistence capability for cancellation. Both operations must run through
 * the client bound to the locked account transaction.
 */
export interface OrderCancellationRepository {
  /**
   * Reads only by account and order identifier. The caller must already hold
   * the account lock.
   */
  findByUserIdAndId(
    userId: number,
    orderId: number,
  ): Promise<CancellableOrder | null>;

  /**
   * Transitions NEW to CANCELLED in one conditional statement scoped by
   * account and order. Returns `true` only when PostgreSQL reports exactly one
   * updated row; it never treats an unacknowledged transition as success.
   */
  markCancelledIfNew(userId: number, orderId: number): Promise<boolean>;
}
