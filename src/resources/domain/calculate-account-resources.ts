import { Decimal } from 'decimal.js';
import type { AccountMovement } from './account-movement.js';
import type {
  AccountResources,
  InstrumentResources,
} from './account-resources.js';
import { InvalidAccountMovementError } from './invalid-account-movement.error.js';

interface MutableInstrumentResources {
  executedQuantity: number;
  sellReservedQuantity: number;
}

interface DecimalShape {
  integerDigits: number;
  decimalPlaces: number;
}

type DecimalConstructor = typeof Decimal;

const normalizedDecimalConstructors = new Map<number, DecimalConstructor>();

export function calculateAccountResources(
  movements: readonly AccountMovement[],
): AccountResources {
  const ExactDecimal = createDecimalConstructor(movements);
  let accountingCash = new ExactDecimal(0);
  let reservedBuyCash = new ExactDecimal(0);
  const instruments = new Map<number, MutableInstrumentResources>();

  for (const movement of movements) {
    if (movement.status === 'REJECTED' || movement.status === 'CANCELLED') {
      continue;
    }

    if (movement.status === 'NEW') {
      if (movement.side === 'BUY') {
        const price = readPrice(movement, ExactDecimal);
        reservedBuyCash = reservedBuyCash.plus(
          movementAmount(movement, price, ExactDecimal),
        );
        continue;
      }

      if (movement.side === 'SELL') {
        const resources = readInstrumentResources(
          instruments,
          movement.instrumentId,
        );
        resources.sellReservedQuantity += movement.size;
        continue;
      }

      throw new InvalidAccountMovementError(
        movement.id,
        `NEW ${movement.side} is not a supported reservation`,
      );
    }

    if (movement.status === 'FILLED') {
      if (movement.side === 'CASH_IN') {
        accountingCash = accountingCash.plus(movement.size);
        continue;
      }

      if (movement.side === 'CASH_OUT') {
        accountingCash = accountingCash.minus(movement.size);
        continue;
      }

      const price = readPrice(movement, ExactDecimal);
      const amount = movementAmount(movement, price, ExactDecimal);
      const resources = readInstrumentResources(
        instruments,
        movement.instrumentId,
      );

      if (movement.side === 'BUY') {
        accountingCash = accountingCash.minus(amount);
        resources.executedQuantity += movement.size;
        continue;
      }

      if (movement.side === 'SELL') {
        accountingCash = accountingCash.plus(amount);
        resources.executedQuantity -= movement.size;
        continue;
      }

      throw new InvalidAccountMovementError(
        movement.id,
        `FILLED ${movement.side} is not a supported execution`,
      );
    }

    throw new InvalidAccountMovementError(
      movement.id,
      `status ${String(movement.status)} is not supported`,
    );
  }

  return {
    accountingCash: normalizeDecimal(accountingCash),
    reservedBuyCash: normalizeDecimal(reservedBuyCash),
    availableCash: normalizeDecimal(accountingCash.minus(reservedBuyCash)),
    instruments: toInstrumentResources(instruments),
  };
}

/**
 * Builds a private Decimal constructor with enough significant digits for the
 * exact aggregate. A product needs at most the digit count of the size plus
 * the integer digits of the price, and keeps the price decimal places. Adding
 * at most `movements.length` terms can add `digits(movements.length)` integer
 * digits. Each movement contributes to at most one cash accumulator, so the
 * available difference is bounded by the same n-term sum. The global Decimal
 * configuration is not modified.
 */
function createDecimalConstructor(
  movements: readonly AccountMovement[],
): DecimalConstructor {
  const shape = measureAmountShape(movements);
  const termCountDigits = String(Math.max(1, movements.length)).length;

  return Decimal.clone({
    precision: shape.integerDigits + shape.decimalPlaces + termCountDigits,
  });
}

function measureAmountShape(
  movements: readonly AccountMovement[],
): DecimalShape {
  let integerDigits = 1;
  let decimalPlaces = 0;

  for (const movement of movements) {
    if (movement.side === 'BUY' || movement.side === 'SELL') {
      if (movement.price !== null) {
        const price = measurePrice(movement.price);
        integerDigits = Math.max(
          integerDigits,
          countIntegerDigits(movement.size) + price.integerDigits,
        );
        decimalPlaces = Math.max(decimalPlaces, price.decimalPlaces);
      }

      continue;
    }

    integerDigits = Math.max(
      integerDigits,
      countIntegerDigits(movement.size),
    );
  }

  return { integerDigits, decimalPlaces };
}

function measurePrice(price: string): DecimalShape {
  const unsigned = price.trim().replace(/^[+-]/, '');
  const [whole = '', fraction = ''] = unsigned.split('.');
  const significantWhole = whole.replace(/^0+/, '');

  return {
    integerDigits: Math.max(1, significantWhole.length),
    decimalPlaces: fraction.length,
  };
}

function countIntegerDigits(value: number): number {
  return Math.max(1, Math.trunc(Math.abs(value)).toString().length);
}

/**
 * Returns an exact value. Values that fit the global significant digit limit
 * use the global constructor; larger values use a local constructor shared by
 * values with the same significant digit count. This keeps equal results
 * structurally comparable regardless of the movement count used to obtain them.
 */
function normalizeDecimal(value: Decimal): Decimal {
  const precision = Math.max(1, value.sd());

  if (precision <= Decimal.precision) {
    return new Decimal(value.toString());
  }

  let ExactDecimal = normalizedDecimalConstructors.get(precision);

  if (ExactDecimal === undefined) {
    ExactDecimal = Decimal.clone({ precision });
    normalizedDecimalConstructors.set(precision, ExactDecimal);
  }

  return new ExactDecimal(value.toString());
}

function readPrice(
  movement: AccountMovement,
  ExactDecimal: DecimalConstructor,
): Decimal {
  if (movement.price === null) {
    throw new InvalidAccountMovementError(movement.id, 'price is required');
  }

  let price: Decimal;

  try {
    price = new ExactDecimal(movement.price);
  } catch {
    throw new InvalidAccountMovementError(movement.id, 'price is not numeric');
  }

  if (!price.isFinite() || price.lte(0)) {
    throw new InvalidAccountMovementError(
      movement.id,
      'price must be finite and positive',
    );
  }

  return price;
}

function movementAmount(
  movement: AccountMovement,
  price: Decimal,
  ExactDecimal: DecimalConstructor,
): Decimal {
  return new ExactDecimal(movement.size).times(price);
}

function readInstrumentResources(
  instruments: Map<number, MutableInstrumentResources>,
  instrumentId: number,
): MutableInstrumentResources {
  const existing = instruments.get(instrumentId);

  if (existing !== undefined) {
    return existing;
  }

  const created: MutableInstrumentResources = {
    executedQuantity: 0,
    sellReservedQuantity: 0,
  };
  instruments.set(instrumentId, created);

  return created;
}

function toInstrumentResources(
  instruments: Map<number, MutableInstrumentResources>,
): InstrumentResources[] {
  return [...instruments.entries()]
    .sort(([left], [right]) => left - right)
    .map(([instrumentId, resources]) => ({
      instrumentId,
      executedQuantity: resources.executedQuantity,
      sellReservedQuantity: resources.sellReservedQuantity,
      availableQuantity:
        resources.executedQuantity - resources.sellReservedQuantity,
    }));
}
