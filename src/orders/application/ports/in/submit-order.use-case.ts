import type { OrderIntent } from '../../../domain/order-intent.js';
import type { PersistedOrderStatus } from '../../../domain/persisted-order.js';

export interface SubmitOrderInput {
  readonly userId: number;
  readonly idempotencyKey: string;
  readonly intent: OrderIntent;
  /** Amount currency; omitted and `ARS` are equivalent and only ARS is supported. */
  readonly currency?: string;
}

export interface SubmitOrderOutput {
  readonly orderId: number;
  readonly status: PersistedOrderStatus;
  readonly replayed: boolean;
}

export interface SubmitOrderUseCase {
  execute(input: SubmitOrderInput): Promise<SubmitOrderOutput>;
}
