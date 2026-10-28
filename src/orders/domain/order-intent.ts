import { Decimal } from 'decimal.js';
import { OrderIntentError } from './order-intent.error.js';

export type OrderIntentSide = 'BUY' | 'SELL';
export type OrderIntentType = 'MARKET' | 'LIMIT';
export type OrderIntentMode = 'size' | 'amount';

export interface OrderIntentInput {
  readonly instrumentId: unknown;
  readonly side: unknown;
  readonly type: unknown;
  readonly size?: unknown;
  readonly amount?: unknown;
  readonly limitPrice?: unknown;
}

export interface OrderIntent {
  readonly instrumentId: number;
  readonly side: OrderIntentSide;
  readonly type: OrderIntentType;
  readonly mode: OrderIntentMode;
  readonly size: string | null;
  readonly amount: string | null;
  readonly limitPrice: string | null;
}

const MAX_MONETARY_DECIMAL_PLACES = 2;

/**
 * Validates semantic fields and returns canonical decimal strings.
 * It does not define HTTP lexical rules such as exponent or trailing-zero
 * acceptance. Valid representations such as 10, 10.0 and 10.00 become "10".
 */
export function createOrderIntent(input: OrderIntentInput): OrderIntent {
  const instrumentId = readInstrumentId(input.instrumentId);
  const side = readSide(input.side);
  const type = readType(input.type);
  const sizeInput = readOptional(input.size);
  const amountInput = readOptional(input.amount);
  const limitPriceInput = readOptional(input.limitPrice);

  if ((sizeInput === null) === (amountInput === null)) {
    throw new OrderIntentError('invalid-mode');
  }

  if (type === 'MARKET' && limitPriceInput !== null) {
    throw new OrderIntentError('invalid-limit-price');
  }

  if (type === 'LIMIT' && limitPriceInput === null) {
    throw new OrderIntentError('invalid-limit-price');
  }

  const mode: OrderIntentMode = sizeInput === null ? 'amount' : 'size';
  const size =
    sizeInput === null
      ? null
      : canonicalizeDecimal(sizeInput, 'invalid-size', {
          integerOnly: true,
        });
  const amount =
    amountInput === null
      ? null
      : canonicalizeDecimal(amountInput, 'invalid-amount', {
          maxDecimalPlaces: MAX_MONETARY_DECIMAL_PLACES,
        });
  const limitPrice =
    limitPriceInput === null
      ? null
      : canonicalizeDecimal(limitPriceInput, 'invalid-limit-price', {
          maxDecimalPlaces: MAX_MONETARY_DECIMAL_PLACES,
        });

  return {
    instrumentId,
    side,
    type,
    mode,
    size,
    amount,
    limitPrice,
  };
}

export function orderIntentsEqual(
  left: OrderIntent,
  right: OrderIntent,
): boolean {
  return (
    left.instrumentId === right.instrumentId &&
    left.side === right.side &&
    left.type === right.type &&
    left.mode === right.mode &&
    left.size === right.size &&
    left.amount === right.amount &&
    left.limitPrice === right.limitPrice
  );
}

function readInstrumentId(value: unknown): number {
  if (
    typeof value !== 'number' ||
    !Number.isSafeInteger(value) ||
    value <= 0
  ) {
    throw new OrderIntentError('invalid-instrument');
  }

  return value;
}

function readSide(value: unknown): OrderIntentSide {
  if (value === 'BUY' || value === 'SELL') {
    return value;
  }

  throw new OrderIntentError('invalid-side');
}

function readType(value: unknown): OrderIntentType {
  if (value === 'MARKET' || value === 'LIMIT') {
    return value;
  }

  throw new OrderIntentError('invalid-type');
}

function readOptional(value: unknown): unknown | null {
  return value === undefined || value === null ? null : value;
}

function canonicalizeDecimal(
  value: unknown,
  code: 'invalid-size' | 'invalid-amount' | 'invalid-limit-price',
  options: {
    readonly integerOnly?: boolean;
    readonly maxDecimalPlaces?: number;
  },
): string {
  if (typeof value !== 'string') {
    throw new OrderIntentError(code);
  }

  let decimal: Decimal;

  try {
    const ExactDecimal = Decimal.clone({
      precision: Math.max(Decimal.precision, value.length + 1),
    });
    decimal = new ExactDecimal(value);
  } catch {
    throw new OrderIntentError(code);
  }

  if (!decimal.isFinite() || !decimal.gt(0)) {
    throw new OrderIntentError(code);
  }

  if (options.integerOnly === true && !decimal.isInteger()) {
    throw new OrderIntentError(code);
  }

  if (
    options.maxDecimalPlaces !== undefined &&
    decimal.decimalPlaces() > options.maxDecimalPlaces
  ) {
    throw new OrderIntentError(code);
  }

  return decimal.toFixed();
}
