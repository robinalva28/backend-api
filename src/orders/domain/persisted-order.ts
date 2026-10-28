export type PersistedOrderStatus =
  | 'NEW'
  | 'FILLED'
  | 'REJECTED'
  | 'CANCELLED';

export interface PersistedOrder {
  readonly id: number;
  readonly userId: number;
  readonly idempotencyKey: string;
  readonly status: PersistedOrderStatus;
  readonly intentMetadata: unknown;
}
