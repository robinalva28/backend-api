import {
  createOrderIntent,
  type OrderIntent,
  type OrderIntentMode,
  type OrderIntentSide,
  type OrderIntentType,
} from './order-intent.js';
import { OrderIntentError } from './order-intent.error.js';

export const ORDER_INTENT_METADATA_VERSION = 1 as const;

export interface OrderIntentParametersV1 {
  readonly instrumentId: number;
  readonly side: OrderIntentSide;
  readonly type: OrderIntentType;
  readonly mode: OrderIntentMode;
  readonly size?: string;
  readonly amount?: string;
  readonly limitPrice?: string;
}

export interface OrderIntentMetadataV1 {
  readonly version: typeof ORDER_INTENT_METADATA_VERSION;
  readonly parameters: OrderIntentParametersV1;
}

/**
 * Builds the versioned JSON-compatible metadata object. Property order is not
 * part of the contract; comparison always uses the semantic fields.
 */
export function buildOrderIntentMetadata(
  intent: OrderIntent,
): OrderIntentMetadataV1 {
  const canonical = createOrderIntent({
    instrumentId: intent.instrumentId,
    side: intent.side,
    type: intent.type,
    size: intent.size,
    amount: intent.amount,
    limitPrice: intent.limitPrice,
  });

  const parameters: OrderIntentParametersV1 = {
    instrumentId: canonical.instrumentId,
    side: canonical.side,
    type: canonical.type,
    mode: canonical.mode,
    ...(canonical.mode === 'size'
      ? { size: requireCanonicalValue(canonical.size, 'invalid-size') }
      : { amount: requireCanonicalValue(canonical.amount, 'invalid-amount') }),
    ...(canonical.type === 'LIMIT'
      ? {
          limitPrice: requireCanonicalValue(
            canonical.limitPrice,
            'invalid-limit-price',
          ),
        }
      : {}),
  };

  return {
    version: ORDER_INTENT_METADATA_VERSION,
    parameters,
  };
}

/**
 * Reads and validates persisted version 1 metadata. Invalid metadata and
 * unknown versions produce internal errors, never a match, conflict or
 * permission to create another order.
 */
export function readOrderIntentMetadata(value: unknown): OrderIntent {
  const metadata = readRecord(value);
  const version = metadata['version'];

  if (
    typeof version !== 'number' ||
    !Number.isSafeInteger(version) ||
    version <= 0
  ) {
    throw new OrderIntentError('invalid-metadata');
  }

  if (version !== ORDER_INTENT_METADATA_VERSION) {
    throw new OrderIntentError('unsupported-metadata-version');
  }

  const parameters = readRecord(metadata['parameters']);
  const mode = readMetadataMode(parameters['mode']);
  const type = readMetadataType(parameters['type']);
  const size = parameters['size'];
  const amount = parameters['amount'];
  const limitPrice = parameters['limitPrice'];

  if (mode === 'size') {
    if (typeof size !== 'string' || !isAbsentOrNull(amount)) {
      throw new OrderIntentError('invalid-metadata');
    }
  } else if (typeof amount !== 'string' || !isAbsentOrNull(size)) {
    throw new OrderIntentError('invalid-metadata');
  }

  if (type === 'LIMIT') {
    if (typeof limitPrice !== 'string') {
      throw new OrderIntentError('invalid-metadata');
    }
  } else if (!isAbsentOrNull(limitPrice)) {
    throw new OrderIntentError('invalid-metadata');
  }

  try {
    return createOrderIntent({
      instrumentId: parameters['instrumentId'],
      side: parameters['side'],
      type,
      size: mode === 'size' ? size : null,
      amount: mode === 'amount' ? amount : null,
      limitPrice: type === 'LIMIT' ? limitPrice : null,
    });
  } catch (error) {
    if (error instanceof OrderIntentError) {
      throw new OrderIntentError('invalid-metadata');
    }

    throw error;
  }
}

function readRecord(value: unknown): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new OrderIntentError('invalid-metadata');
  }

  return value as Record<string, unknown>;
}

function readMetadataMode(value: unknown): OrderIntentMode {
  if (value === 'size' || value === 'amount') {
    return value;
  }

  throw new OrderIntentError('invalid-metadata');
}

function readMetadataType(value: unknown): OrderIntentType {
  if (value === 'MARKET' || value === 'LIMIT') {
    return value;
  }

  throw new OrderIntentError('invalid-metadata');
}

function isAbsentOrNull(value: unknown): boolean {
  return value === undefined || value === null;
}

function requireCanonicalValue(
  value: string | null,
  code: 'invalid-size' | 'invalid-amount' | 'invalid-limit-price',
): string {
  if (value === null) {
    throw new OrderIntentError(code);
  }

  return value;
}
