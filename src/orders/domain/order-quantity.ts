import type { OrderIntent } from './order-intent.js';

/** PostgreSQL `INT` maximum for `orders.size`. */
export const MAX_ORDER_SIZE = 2_147_483_647;

/**
 * Resolves the final whole-share quantity for an order.
 *
 * Size intents preserve their explicit quantity. Amount intents use the exact
 * floor of `amount / price` with integer arithmetic over the decimal strings;
 * no intermediate rounding is performed. Zero and quantities outside the
 * persisted `INT` range are not representable and return `null`.
 */
export function resolveOrderSize(
  intent: OrderIntent,
  price: string,
): number | null {
  if (intent.mode === 'size') {
    return readRepresentableSize(intent.size);
  }

  if (intent.amount === null) {
    return null;
  }

  const quantity = floorQuotient(intent.amount, price);

  if (
    quantity === null ||
    quantity <= 0n ||
    quantity > BigInt(MAX_ORDER_SIZE)
  ) {
    return null;
  }

  return Number(quantity);
}

function readRepresentableSize(value: string | null): number | null {
  if (value === null) {
    return null;
  }

  const parsed = parseDecimal(value);

  if (parsed === null || parsed.scale !== 0) {
    return null;
  }

  if (parsed.unscaled <= 0n || parsed.unscaled > BigInt(MAX_ORDER_SIZE)) {
    return null;
  }

  return Number(parsed.unscaled);
}

function floorQuotient(amount: string, price: string): bigint | null {
  const dividend = parseDecimal(amount);
  const divisor = parseDecimal(price);

  if (dividend === null || divisor === null || divisor.unscaled === 0n) {
    return null;
  }

  const scale = Math.max(dividend.scale, divisor.scale);
  const scaledDividend =
    dividend.unscaled * powerOfTen(scale - dividend.scale);
  const scaledDivisor = divisor.unscaled * powerOfTen(scale - divisor.scale);

  return scaledDividend / scaledDivisor;
}

interface ParsedDecimal {
  readonly unscaled: bigint;
  readonly scale: number;
}

function parseDecimal(value: string): ParsedDecimal | null {
  const match = /^(\d+)(?:\.(\d+))?$/.exec(value);

  if (match === null) {
    return null;
  }

  const whole = match[1] ?? '';
  const fraction = match[2] ?? '';

  return {
    unscaled: BigInt(`${whole}${fraction}`),
    scale: fraction.length,
  };
}

function powerOfTen(exponent: number): bigint {
  return 10n ** BigInt(exponent);
}
