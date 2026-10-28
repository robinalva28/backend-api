export type PersistedOrderMappingField =
  | 'id'
  | 'userId'
  | 'idempotencyKey'
  | 'status';

export class PersistedOrderMappingError extends Error {
  readonly field: PersistedOrderMappingField;

  constructor(field: PersistedOrderMappingField) {
    super(`Persisted order has an invalid ${field}.`);
    this.name = 'PersistedOrderMappingError';
    this.field = field;
  }
}
