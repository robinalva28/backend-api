import { Decimal } from 'decimal.js';
import {
  createOrderIntent,
  type OrderIntent,
  type OrderIntentType,
} from './order-intent.js';
import { PreparedOrderError } from './prepared-order.error.js';

export type PreparedOrderStatus = 'NEW' | 'FILLED' | 'REJECTED';

export interface PreparedOrderInput {
  readonly idempotencyKey: string;
  readonly intent: OrderIntent;
  readonly size: number;
  readonly price: string;
  readonly status: PreparedOrderStatus;
  readonly datetime: string;
}

/**
 * An order whose business values were already decided upstream. The original
 * intent is preserved for metadata; `size` is the final quantity and may
 * differ from the original amount when the intent used the amount mode.
 */
export interface PreparedOrder {
  readonly idempotencyKey: string;
  readonly intent: OrderIntent;
  readonly size: number;
  readonly price: string;
  readonly status: PreparedOrderStatus;
  readonly datetime: string;
}

/** PostgreSQL `INT` maximum for `orders.size`. */
const MAX_ORDER_SIZE = 2_147_483_647;
/** PostgreSQL `NUMERIC(10, 2)` has at most 8 integer digits. */
const MAX_PRICE_INTEGER_DIGITS = 8;
const MAX_MONETARY_DECIMAL_PLACES = 2;
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DATETIME_PATTERN =
  /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,6}))?$/;

/**
 * Validates the prepared values against the internal persistence contract.
 * It does not select a price, convert an amount, check resources, decide the
 * status, choose a clock or define HTTP ranges and errors. The datetime is a
 * wall-clock value formatted as `YYYY-MM-DDTHH:mm:ss[.fraction]`; B04-E does
 * not assign a timezone policy.
 */
export function createPreparedOrder(
  input: PreparedOrderInput,
): PreparedOrder {
  const intent = readIntent(input.intent);
  const idempotencyKey = readIdempotencyKey(input.idempotencyKey);
  const size = readSize(input.size);
  const price = readPrice(input.price);
  const status = readStatus(input.status);

  assertStatusCompatible(status, intent.type);

  if (intent.mode === 'size' && intent.size !== String(size)) {
    throw new PreparedOrderError('size-intent-mismatch');
  }

  if (intent.type === 'LIMIT' && intent.limitPrice !== price) {
    throw new PreparedOrderError('price-intent-mismatch');
  }

  return {
    idempotencyKey,
    intent,
    size,
    price,
    status,
    datetime: readDatetime(input.datetime),
  };
}

function readIntent(value: OrderIntent | null | undefined): OrderIntent {
  if (value === null || value === undefined || typeof value !== 'object') {
    throw new PreparedOrderError('invalid-intent');
  }

  return createOrderIntent({
    instrumentId: value.instrumentId,
    side: value.side,
    type: value.type,
    size: value.size,
    amount: value.amount,
    limitPrice: value.limitPrice,
  });
}

function readIdempotencyKey(value: unknown): string {
  if (typeof value !== 'string' || !UUID_PATTERN.test(value)) {
    throw new PreparedOrderError('invalid-idempotency-key');
  }

  return value.toLowerCase();
}

function readSize(value: unknown): number {
  if (
    typeof value !== 'number' ||
    !Number.isSafeInteger(value) ||
    value <= 0 ||
    value > MAX_ORDER_SIZE
  ) {
    throw new PreparedOrderError('invalid-size');
  }

  return value;
}

function readPrice(value: unknown): string {
  if (typeof value !== 'string' || !/^\d+(?:\.\d+)?$/.test(value)) {
    throw new PreparedOrderError('invalid-price');
  }

  let decimal: Decimal;

  try {
    const ExactDecimal = Decimal.clone({
      precision: Math.max(Decimal.precision, value.length + 1),
    });
    decimal = new ExactDecimal(value);
  } catch {
    throw new PreparedOrderError('invalid-price');
  }

  if (!decimal.isFinite() || !decimal.gt(0)) {
    throw new PreparedOrderError('invalid-price');
  }

  if (decimal.decimalPlaces() > MAX_MONETARY_DECIMAL_PLACES) {
    throw new PreparedOrderError('invalid-price');
  }

  const canonical = decimal.toFixed();
  const [integerPart = ''] = canonical.split('.');

  if (integerPart.length > MAX_PRICE_INTEGER_DIGITS) {
    throw new PreparedOrderError('invalid-price');
  }

  return canonical;
}

function readStatus(value: unknown): PreparedOrderStatus {
  if (value === 'NEW' || value === 'FILLED' || value === 'REJECTED') {
    return value;
  }

  throw new PreparedOrderError('invalid-status');
}

function assertStatusCompatible(
  status: PreparedOrderStatus,
  type: OrderIntentType,
): void {
  const allowed =
    type === 'MARKET'
      ? status === 'FILLED' || status === 'REJECTED'
      : status === 'NEW' || status === 'REJECTED';

  if (!allowed) {
    throw new PreparedOrderError('incompatible-status');
  }
}

function readDatetime(value: unknown): string {
  if (typeof value !== 'string') {
    throw new PreparedOrderError('invalid-datetime');
  }

  const match = DATETIME_PATTERN.exec(value);

  if (match === null) {
    throw new PreparedOrderError('invalid-datetime');
  }

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const hour = Number(match[4]);
  const minute = Number(match[5]);
  const second = Number(match[6]);

  if (
    year < 1 ||
    year > 9999 ||
    month < 1 ||
    month > 12 ||
    day < 1 ||
    day > daysInMonth(year, month) ||
    hour > 23 ||
    minute > 59 ||
    second > 59
  ) {
    throw new PreparedOrderError('invalid-datetime');
  }

  return value;
}

function daysInMonth(year: number, month: number): number {
  if (month === 2) {
    return isLeapYear(year) ? 29 : 28;
  }

  return [4, 6, 9, 11].includes(month) ? 30 : 31;
}

function isLeapYear(year: number): boolean {
  return year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
}
