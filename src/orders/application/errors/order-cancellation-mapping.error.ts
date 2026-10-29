export type OrderCancellationMappingField = 'id' | 'userId' | 'status';

/**
 * A stored row could not be represented as a cancellable order. The caller
 * must not interpret this failure as absence or as a business conflict.
 */
export class OrderCancellationMappingError extends Error {
  readonly field: OrderCancellationMappingField;

  constructor(field: OrderCancellationMappingField) {
    super(`Stored order has an invalid cancellation ${field}.`);
    this.name = 'OrderCancellationMappingError';
    this.field = field;
  }
}
