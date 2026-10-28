import {
  orderIntentsEqual,
  type OrderIntent,
} from '../domain/order-intent.js';
import { readOrderIntentMetadata } from '../domain/order-intent-metadata.js';
import type { PersistedOrder } from '../domain/persisted-order.js';
import type { PersistedOrderRepository } from './ports/out/persisted-order.repository.js';

export interface OrderReplayInput {
  readonly userId: number;
  readonly idempotencyKey: string;
  readonly intent: OrderIntent;
}

export type OrderReplayResolution =
  | { readonly outcome: 'absent' }
  | { readonly outcome: 'match'; readonly order: PersistedOrder }
  | { readonly outcome: 'conflict' };

/**
 * Resolves a replay inside the already-locked account transaction. This
 * function never creates, updates or cancels an order. Invalid metadata and
 * repository failures propagate as internal errors instead of absence or a
 * conflict.
 */
export async function resolveOrderReplay(
  repository: PersistedOrderRepository,
  input: OrderReplayInput,
): Promise<OrderReplayResolution> {
  const order = await repository.findByUserIdAndIdempotencyKey(
    input.userId,
    input.idempotencyKey,
  );

  if (order === null) {
    return { outcome: 'absent' };
  }

  const storedIntent = readOrderIntentMetadata(order.intentMetadata);

  if (!orderIntentsEqual(storedIntent, input.intent)) {
    return { outcome: 'conflict' };
  }

  return { outcome: 'match', order };
}
