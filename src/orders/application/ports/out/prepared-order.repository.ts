import type { PersistedOrder } from '../../../domain/persisted-order.js';
import type { PreparedOrder } from '../../../domain/prepared-order.js';

/**
 * Account-scoped write port. The implementation is built per transaction
 * execution with the locked account and the same client as the read port.
 */
export interface PreparedOrderRepository {
  insert(preparedOrder: PreparedOrder): Promise<PersistedOrder>;
}
