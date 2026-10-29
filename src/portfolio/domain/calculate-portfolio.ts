import { Decimal } from 'decimal.js';
import { calculateAccountResources } from '../../resources/domain/calculate-account-resources.js';
import type { AccountResources } from '../../resources/domain/account-resources.js';
import type { Instrument } from '../../instruments/domain/instrument.js';
import type { LatestQuote } from '../../quotes/domain/latest-quote.js';
import { InvalidPortfolioDataError } from './invalid-portfolio-data.error.js';
import type { Portfolio, PortfolioPosition } from './portfolio.js';
import type { PortfolioMovement } from './portfolio-movement.js';
import type { PortfolioReadSnapshot } from './portfolio-read-snapshot.js';

type DecimalConstructor = typeof Decimal;

interface DecimalShape {
  integerDigits: number;
  decimalPlaces: number;
}

interface CostState {
  quantity: number;
  /**
   * Exact average cost per share `C / Q`. A valid partial sale leaves this
   * fraction unchanged. `null` means the cost cannot be calculated.
   */
  averageCost: ExactFraction | null;
}

interface ExactFraction {
  readonly numerator: bigint;
  readonly denominator: bigint;
}

interface PositionResult {
  readonly positions: readonly PortfolioPosition[];
  readonly positionValueTotal: Decimal;
}

const ZERO_COST: ExactFraction = { numerator: 0n, denominator: 1n };

export function calculatePortfolio(
  snapshot: PortfolioReadSnapshot,
): Portfolio {
  // B02 remains the single source of truth for accounting cash, NEW
  // reservations and net executed quantities. Passing the same movements keeps
  // its cash rules from being duplicated here.
  const resources = calculateAccountResources(snapshot.movements);
  const ExactDecimal = createPortfolioDecimalConstructor(snapshot);
  const costs = calculateCostStates(snapshot.movements, ExactDecimal);
  const { positions, positionValueTotal } = buildPositions(
    snapshot,
    resources,
    costs,
    ExactDecimal,
  );
  const accountingCash = toExactDecimal(
    resources.accountingCash,
    ExactDecimal,
  );
  const availableCash = toExactDecimal(resources.availableCash, ExactDecimal);

  return {
    totalValue: formatMoney(accountingCash.plus(positionValueTotal)),
    availableCash: formatMoney(availableCash),
    positions,
  };
}

/**
 * Applies the moving average cost rule in the sequence supplied by the read
 * port. The port guarantees `datetime` ascending and `id` ascending only for
 * equal timestamps; this function deliberately does not re-sort or convert the
 * timestamp text to Date.
 *
 * The average cost is kept as an exact rational number. A valid partial sale
 * leaves `C / Q` unchanged, so it never introduces a rounded division. A later
 * buy updates that fraction exactly using the previous quantity and cost.
 */
function calculateCostStates(
  movements: readonly PortfolioMovement[],
  ExactDecimal: DecimalConstructor,
): Map<number, CostState> {
  const states = new Map<number, CostState>();

  for (const movement of movements) {
    if (movement.status !== 'FILLED') {
      continue;
    }

    if (movement.side !== 'BUY' && movement.side !== 'SELL') {
      continue;
    }

    if (movement.size === 0) {
      continue;
    }

    const state = readCostState(states, movement.instrumentId);

    if (movement.side === 'BUY') {
      const nextQuantity = state.quantity + movement.size;

      if (state.averageCost !== null) {
        const price = fractionFromDecimal(
          readExecutionPrice(movement, ExactDecimal),
        );
        const previousCost = multiplyFractions(
          fractionFromInteger(state.quantity),
          state.averageCost,
        );
        const addedCost = multiplyFractions(
          fractionFromInteger(movement.size),
          price,
        );

        state.averageCost = divideFractions(
          addFractions(previousCost, addedCost),
          fractionFromInteger(nextQuantity),
        );
      }

      state.quantity = nextQuantity;
      continue;
    }

    const previousQuantity = state.quantity;
    const nextQuantity = previousQuantity - movement.size;
    state.quantity = nextQuantity;

    if (
      state.averageCost === null ||
      previousQuantity <= 0 ||
      movement.size > previousQuantity
    ) {
      // A sale beyond the available history makes the cost not calculable.
      // Later buys increase the real quantity but never rebuild this cost.
      state.averageCost = null;
      continue;
    }

    if (nextQuantity === 0) {
      // A valid full close is exactly zero by definition.
      state.averageCost = ZERO_COST;
    }
    // A valid partial sale leaves the exact average cost unchanged.
  }

  return states;
}

function buildPositions(
  snapshot: PortfolioReadSnapshot,
  resources: AccountResources,
  costs: ReadonlyMap<number, CostState>,
  ExactDecimal: DecimalConstructor,
): PositionResult {
  const positions: PortfolioPosition[] = [];
  let positionValueTotal = new ExactDecimal(0);

  for (const instrumentResources of resources.instruments) {
    const instrumentId = instrumentResources.instrumentId;
    const quantity = instrumentResources.executedQuantity;

    if (quantity === 0) {
      continue;
    }

    const instrument = findSingleInstrument(snapshot.instruments, instrumentId);
    const quote = findSingleQuote(snapshot.quotes, instrumentId);
    const close = readPositiveDecimal(quote.close, ExactDecimal);

    if (close === null) {
      throw new InvalidPortfolioDataError(
        `latest close for instrument ${instrumentId} is not finite and positive`,
      );
    }

    const cost = costs.get(instrumentId);

    if (cost === undefined || cost.quantity !== quantity) {
      throw new InvalidPortfolioDataError(
        `executed quantity for instrument ${instrumentId} is inconsistent`,
      );
    }

    const closeFraction = fractionFromDecimal(close);
    const positionValue = new ExactDecimal(quantity).times(close);
    positionValueTotal = positionValueTotal.plus(positionValue);
    const previousClose = readPositiveDecimal(
      quote.previousClose,
      ExactDecimal,
    );

    positions.push({
      instrumentId,
      ticker: instrument.ticker,
      name: instrument.name,
      quantity,
      positionValue: formatMoney(positionValue),
      totalReturnPercent: readTotalReturnPercent(
        quantity,
        closeFraction,
        cost.averageCost,
      ),
      dailyReturnPercent:
        previousClose === null
          ? null
          : formatRelativePercent(
              subtractFractions(
                closeFraction,
                fractionFromDecimal(previousClose),
              ),
              fractionFromDecimal(previousClose),
            ),
    });
  }

  return { positions, positionValueTotal };
}

function readTotalReturnPercent(
  quantity: number,
  close: ExactFraction,
  averageCost: ExactFraction | null,
): number | null {
  if (
    quantity <= 0 ||
    averageCost === null ||
    averageCost.numerator <= 0n
  ) {
    return null;
  }

  const quantityFraction = fractionFromInteger(quantity);
  const positionValue = multiplyFractions(quantityFraction, close);
  const cost = multiplyFractions(quantityFraction, averageCost);

  if (cost.numerator <= 0n) {
    return null;
  }

  // The approved formula uses the exact position value and remaining cost:
  // 100 × (V - C) / C, with V = Q × close and C = Q × averageCost.
  return formatRelativePercent(
    subtractFractions(positionValue, cost),
    cost,
  );
}

function readCostState(
  states: Map<number, CostState>,
  instrumentId: number,
): CostState {
  const existing = states.get(instrumentId);

  if (existing !== undefined) {
    return existing;
  }

  const created: CostState = {
    quantity: 0,
    averageCost: ZERO_COST,
  };
  states.set(instrumentId, created);

  return created;
}

function readExecutionPrice(
  movement: PortfolioMovement,
  ExactDecimal: DecimalConstructor,
): Decimal {
  if (movement.price === null) {
    throw new InvalidPortfolioDataError(
      `movement ${movement.id} has no execution price`,
    );
  }

  let price: Decimal;

  try {
    price = new ExactDecimal(movement.price);
  } catch {
    throw new InvalidPortfolioDataError(
      `movement ${movement.id} price is not numeric`,
    );
  }

  if (!price.isFinite() || price.lte(0)) {
    throw new InvalidPortfolioDataError(
      `movement ${movement.id} price is not finite and positive`,
    );
  }

  return price;
}

function findSingleInstrument(
  instruments: readonly Instrument[],
  instrumentId: number,
): Instrument {
  const matches = instruments.filter(
    (instrument) => instrument.id === instrumentId,
  );

  if (matches.length === 0) {
    throw new InvalidPortfolioDataError(
      `metadata for instrument ${instrumentId} is missing`,
    );
  }

  if (matches.length > 1) {
    throw new InvalidPortfolioDataError(
      `metadata for instrument ${instrumentId} is duplicated`,
    );
  }

  return matches[0] as Instrument;
}

function findSingleQuote(
  quotes: readonly LatestQuote[],
  instrumentId: number,
): LatestQuote {
  const matches = quotes.filter((quote) => quote.instrumentId === instrumentId);

  if (matches.length === 0) {
    throw new InvalidPortfolioDataError(
      `latest quote for instrument ${instrumentId} is missing`,
    );
  }

  if (matches.length > 1) {
    throw new InvalidPortfolioDataError(
      `latest quote for instrument ${instrumentId} is duplicated`,
    );
  }

  return matches[0] as LatestQuote;
}

function readPositiveDecimal(
  value: string | null,
  ExactDecimal: DecimalConstructor,
): Decimal | null {
  if (typeof value !== 'string') {
    return null;
  }

  const trimmed = value.trim();

  if (trimmed.length === 0) {
    return null;
  }

  let decimal: Decimal;

  try {
    decimal = new ExactDecimal(trimmed);
  } catch {
    return null;
  }

  if (!decimal.isFinite() || decimal.lte(0)) {
    return null;
  }

  return decimal;
}

function toExactDecimal(
  value: Decimal,
  ExactDecimal: DecimalConstructor,
): Decimal {
  return new ExactDecimal(value.toFixed());
}

/**
 * Money is produced by exact finite products and sums. This presentation step
 * rounds that exact amount to cents with explicit ROUND_HALF_UP, away from zero
 * at ties, without altering the global Decimal configuration.
 */
function formatMoney(value: Decimal): string {
  const formatted = value.toFixed(2, Decimal.ROUND_HALF_UP);

  return formatted === '-0.00' ? '0.00' : formatted;
}

/**
 * Rounds an exact percentage to two decimals with ROUND_HALF_UP semantics:
 * an exact tie moves away from zero. The integer operation sees the complete
 * rational value, so no finite division can move a tie to the wrong side.
 */
function formatRelativePercent(
  difference: ExactFraction,
  base: ExactFraction,
): number {
  const percent = multiplyFractions(
    exactFraction(100n, 1n),
    divideFractions(difference, base),
  );
  const scaledNumerator = percent.numerator * 100n;
  const negative = scaledNumerator < 0n;
  const magnitude = negative ? -scaledNumerator : scaledNumerator;
  let hundredths = magnitude / percent.denominator;
  const remainder = magnitude % percent.denominator;

  if (remainder * 2n >= percent.denominator) {
    hundredths += 1n;
  }

  const signedHundredths = negative ? -hundredths : hundredths;
  const numeric = Number(signedHundredths) / 100;

  if (!Number.isFinite(numeric)) {
    throw new InvalidPortfolioDataError(
      'return percentage is not finite after rounding',
    );
  }

  return numeric === 0 ? 0 : numeric;
}

function exactFraction(
  numerator: bigint,
  denominator: bigint,
): ExactFraction {
  if (denominator === 0n) {
    throw new InvalidPortfolioDataError('percentage division by zero');
  }

  if (numerator === 0n) {
    return ZERO_COST;
  }

  let normalizedNumerator = numerator;
  let normalizedDenominator = denominator;

  if (normalizedDenominator < 0n) {
    normalizedNumerator = -normalizedNumerator;
    normalizedDenominator = -normalizedDenominator;
  }

  const divisor = greatestCommonDivisor(
    normalizedNumerator < 0n ? -normalizedNumerator : normalizedNumerator,
    normalizedDenominator,
  );

  return {
    numerator: normalizedNumerator / divisor,
    denominator: normalizedDenominator / divisor,
  };
}

function addFractions(
  left: ExactFraction,
  right: ExactFraction,
): ExactFraction {
  return exactFraction(
    left.numerator * right.denominator +
      right.numerator * left.denominator,
    left.denominator * right.denominator,
  );
}

function subtractFractions(
  left: ExactFraction,
  right: ExactFraction,
): ExactFraction {
  return exactFraction(
    left.numerator * right.denominator -
      right.numerator * left.denominator,
    left.denominator * right.denominator,
  );
}

function multiplyFractions(
  left: ExactFraction,
  right: ExactFraction,
): ExactFraction {
  return exactFraction(
    left.numerator * right.numerator,
    left.denominator * right.denominator,
  );
}

function divideFractions(
  left: ExactFraction,
  right: ExactFraction,
): ExactFraction {
  return exactFraction(
    left.numerator * right.denominator,
    left.denominator * right.numerator,
  );
}

function fractionFromInteger(value: number): ExactFraction {
  return exactFraction(BigInt(value), 1n);
}

function fractionFromDecimal(value: Decimal): ExactFraction {
  return fractionFromPlainDecimal(value.toFixed());
}

function fractionFromPlainDecimal(value: string): ExactFraction {
  const match = /^([+-]?)(\d+)(?:\.(\d+))?$/.exec(value);

  if (match === null) {
    throw new InvalidPortfolioDataError(
      'decimal value is not a plain finite number',
    );
  }

  const sign = match[1] === '-' ? -1n : 1n;
  const whole = match[2] ?? '0';
  const fraction = match[3] ?? '';
  const numerator = sign * BigInt(`${whole}${fraction}`);
  const denominator = 10n ** BigInt(fraction.length);

  return exactFraction(numerator, denominator);
}

function greatestCommonDivisor(left: bigint, right: bigint): bigint {
  let currentLeft = left;
  let currentRight = right;

  while (currentRight !== 0n) {
    const remainder = currentLeft % currentRight;
    currentLeft = currentRight;
    currentRight = remainder;
  }

  return currentLeft === 0n ? 1n : currentLeft;
}

/**
 * Local constructor for exact finite money products and sums. Its precision
 * covers the widest product shape, the operand decimal places and the extra
 * integer digits added by accumulation. Cost and percentage calculations do
 * not use it: they use exact rational arithmetic. The global Decimal
 * configuration is never modified.
 */
function createPortfolioDecimalConstructor(
  snapshot: PortfolioReadSnapshot,
): DecimalConstructor {
  const shape = measureSnapshotShape(snapshot);
  const termCountDigits = String(
    Math.max(1, snapshot.movements.length + snapshot.quotes.length + 1),
  ).length;

  return Decimal.clone({
    precision: Math.max(
      1,
      shape.integerDigits + shape.decimalPlaces + termCountDigits,
    ),
  });
}

/**
 * Covers the widest exact amount (size x price or quantity x close), its
 * decimal places and the digits added by accumulating several movements.
 */
function measureSnapshotShape(
  snapshot: PortfolioReadSnapshot,
): DecimalShape {
  let integerDigits = 1;
  let decimalPlaces = 0;
  let executedQuantityMagnitude = 0;

  for (const movement of snapshot.movements) {
    const sizeDigits = countIntegerDigits(movement.size);

    if (
      (movement.side === 'BUY' || movement.side === 'SELL') &&
      movement.price !== null
    ) {
      const price = measureDecimalShape(movement.price);
      integerDigits = Math.max(
        integerDigits,
        sizeDigits + price.integerDigits,
      );
      decimalPlaces = Math.max(decimalPlaces, price.decimalPlaces);

      if (movement.status === 'FILLED') {
        executedQuantityMagnitude += Math.abs(movement.size);
      }

      continue;
    }

    integerDigits = Math.max(integerDigits, sizeDigits);
  }

  const quantityDigits = countIntegerDigits(executedQuantityMagnitude);

  for (const quote of snapshot.quotes) {
    for (const value of [quote.close, quote.previousClose]) {
      if (value === null) {
        continue;
      }

      const shape = measureDecimalShape(value);
      integerDigits = Math.max(
        integerDigits,
        quantityDigits + shape.integerDigits,
      );
      decimalPlaces = Math.max(decimalPlaces, shape.decimalPlaces);
    }
  }

  return { integerDigits, decimalPlaces };
}

function measureDecimalShape(value: string): DecimalShape {
  const unsigned = value.trim().replace(/^[+-]/, '');
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
