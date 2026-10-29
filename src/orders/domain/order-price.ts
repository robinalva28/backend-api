import { Decimal } from 'decimal.js';

/**
 * Validates a market close as a finite positive decimal and returns its
 * canonical plain representation. It never substitutes another quote or
 * changes the global Decimal configuration.
 */
export function readPositivePrice(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null;
  }

  let decimal: Decimal;

  try {
    const ExactDecimal = Decimal.clone({
      precision: Math.max(Decimal.precision, value.length + 1),
    });
    decimal = new ExactDecimal(value);
  } catch {
    return null;
  }

  if (!decimal.isFinite() || !decimal.gt(0)) {
    return null;
  }

  return decimal.toFixed();
}
