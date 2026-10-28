import type { PersistedOrder } from '../../../domain/persisted-order.js';

export interface PersistedOrderRepository {
  findByUserIdAndIdempotencyKey(
    userId: number,
    idempotencyKey: string,
  ): Promise<PersistedOrder | null>;
}
