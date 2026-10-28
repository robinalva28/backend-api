/**
 * Internal failure while inserting a prepared order. It preserves the driver
 * error as `cause` and only copies the technical fields needed to identify
 * the violated constraint. Arbitrary driver messages and details are not
 * exposed.
 */
export class PreparedOrderPersistenceError extends Error {
  readonly code: string | undefined;
  readonly constraint: string | undefined;

  constructor(cause: unknown) {
    super('The prepared order could not be persisted.', { cause });
    this.name = 'PreparedOrderPersistenceError';
    this.code = readStringProperty(cause, 'code');
    this.constraint = readStringProperty(cause, 'constraint');
  }
}

function readStringProperty(
  value: unknown,
  property: 'code' | 'constraint',
): string | undefined {
  if (value === null || typeof value !== 'object') {
    return undefined;
  }

  const candidate = (value as Record<string, unknown>)[property];

  return typeof candidate === 'string' ? candidate : undefined;
}
