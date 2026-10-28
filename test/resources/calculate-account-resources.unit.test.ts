import { Decimal } from 'decimal.js';
import { describe, expect, it } from 'vitest';
import type { AccountMovement } from '../../src/resources/domain/account-movement.js';
import { calculateAccountResources } from '../../src/resources/domain/calculate-account-resources.js';
import { InvalidAccountMovementError } from '../../src/resources/domain/invalid-account-movement.error.js';

const CASH_INSTRUMENT_ID = 999;
const MAX_SIZE = 2_147_483_647;
const MAX_PRICE = '99999999.99';
const FIVE_MAX_RESERVATION = '1073741823392625817.65';

function cashResources(movements: readonly AccountMovement[]): {
  accounting: string;
  reserved: string;
  available: string;
} {
  const resources = calculateAccountResources(movements);

  return {
    accounting: resources.accountingCash.toFixed(2),
    reserved: resources.reservedBuyCash.toFixed(2),
    available: resources.availableCash.toFixed(2),
  };
}

function filledCashIn(id: number, size: number): AccountMovement {
  return {
    id,
    instrumentId: CASH_INSTRUMENT_ID,
    side: 'CASH_IN',
    status: 'FILLED',
    size,
    price: '1',
  };
}

function maximumBuyNew(id: number): AccountMovement {
  return {
    id,
    instrumentId: 47,
    side: 'BUY',
    status: 'NEW',
    size: MAX_SIZE,
    price: MAX_PRICE,
  };
}

function mixedMovements(): AccountMovement[] {
  return [
    {
      id: 1,
      instrumentId: CASH_INSTRUMENT_ID,
      side: 'CASH_IN',
      status: 'FILLED',
      size: 2_000_000_000,
      price: '1',
    },
    {
      ...maximumBuyNew(2),
      status: 'FILLED',
    },
    {
      ...maximumBuyNew(3),
      status: 'FILLED',
    },
    {
      ...maximumBuyNew(4),
      status: 'FILLED',
    },
    {
      ...maximumBuyNew(5),
      status: 'FILLED',
    },
    {
      ...maximumBuyNew(6),
      status: 'FILLED',
    },
    {
      ...maximumBuyNew(7),
      side: 'SELL',
      status: 'FILLED',
    },
    {
      id: 8,
      instrumentId: CASH_INSTRUMENT_ID,
      side: 'CASH_OUT',
      status: 'FILLED',
      size: 1_234_567_890,
      price: '1',
    },
    maximumBuyNew(9),
    {
      id: 10,
      instrumentId: 47,
      side: 'SELL',
      status: 'NEW',
      size: 7,
      price: null,
    },
  ];
}

function rotate<T>(values: readonly T[], offset: number): T[] {
  return [...values.slice(offset), ...values.slice(0, offset)];
}

function oracleCash(movements: readonly AccountMovement[]): {
  accounting: string;
  reserved: string;
  available: string;
} {
  let accounting = 0n;
  let reserved = 0n;

  for (const movement of movements) {
    if (movement.status === 'REJECTED' || movement.status === 'CANCELLED') {
      continue;
    }

    if (movement.status === 'NEW') {
      if (movement.side === 'BUY') {
        reserved += BigInt(movement.size) * priceCents(movement.price);
      }

      continue;
    }

    if (movement.side === 'CASH_IN') {
      accounting += BigInt(movement.size) * 100n;
      continue;
    }

    if (movement.side === 'CASH_OUT') {
      accounting -= BigInt(movement.size) * 100n;
      continue;
    }

    const amount = BigInt(movement.size) * priceCents(movement.price);

    accounting += movement.side === 'SELL' ? amount : -amount;
  }

  return {
    accounting: formatCents(accounting),
    reserved: formatCents(reserved),
    available: formatCents(accounting - reserved),
  };
}

function priceCents(price: string | null): bigint {
  if (price === null) {
    throw new Error('The oracle requires a price.');
  }

  const match = /^([+-]?)(\d+)(?:\.(\d{1,2}))?$/.exec(price);

  if (match === null) {
    throw new Error(`The oracle does not support price ${price}.`);
  }

  const sign = match[1] ?? '';
  const whole = match[2] ?? '0';
  const fraction = (match[3] ?? '').padEnd(2, '0');
  const cents = BigInt(whole) * 100n + BigInt(fraction);

  return sign === '-' ? -cents : cents;
}

function formatCents(cents: bigint): string {
  const sign = cents < 0n ? '-' : '';
  const absolute = cents < 0n ? -cents : cents;
  const fraction = (absolute % 100n).toString().padStart(2, '0');

  return `${sign}${absolute / 100n}.${fraction}`;
}

function globalDecimalConfig(): Record<string, unknown> {
  return {
    precision: Decimal.precision,
    rounding: Decimal.rounding,
    toExpNeg: Decimal.toExpNeg,
    toExpPos: Decimal.toExpPos,
    minE: Decimal.minE,
    maxE: Decimal.maxE,
    crypto: Decimal.crypto,
    modulo: Decimal.modulo,
  };
}

describe('calculateAccountResources', () => {
  it('derives executed cash and holdings, then subtracts NEW reservations without changing executions', () => {
    const executed: AccountMovement[] = [
      filledCashIn(1, 1_000),
      {
        id: 2,
        instrumentId: 47,
        side: 'BUY',
        status: 'FILLED',
        size: 3,
        price: '100',
      },
      {
        id: 3,
        instrumentId: 47,
        side: 'SELL',
        status: 'FILLED',
        size: 1,
        price: '120',
      },
    ];

    expect(cashResources(executed)).toEqual({
      accounting: '820.00',
      reserved: '0.00',
      available: '820.00',
    });
    expect(calculateAccountResources(executed).instruments).toEqual([
      {
        instrumentId: 47,
        executedQuantity: 2,
        sellReservedQuantity: 0,
        availableQuantity: 2,
      },
    ]);

    const withBuyReservation: AccountMovement[] = [
      ...executed,
      {
        id: 4,
        instrumentId: 47,
        side: 'BUY',
        status: 'NEW',
        size: 2,
        price: '50',
      },
    ];
    const afterBuyReservation = calculateAccountResources(withBuyReservation);

    expect(afterBuyReservation.accountingCash.toFixed(2)).toBe('820.00');
    expect(afterBuyReservation.reservedBuyCash.toFixed(2)).toBe('100.00');
    expect(afterBuyReservation.availableCash.toFixed(2)).toBe('720.00');
    expect(afterBuyReservation.instruments).toEqual([
      {
        instrumentId: 47,
        executedQuantity: 2,
        sellReservedQuantity: 0,
        availableQuantity: 2,
      },
    ]);

    const afterSellReservation = calculateAccountResources([
      ...withBuyReservation,
      {
        id: 5,
        instrumentId: 47,
        side: 'SELL',
        status: 'NEW',
        size: 1,
        price: null,
      },
    ]);

    expect(afterSellReservation.accountingCash.toFixed(2)).toBe('820.00');
    expect(afterSellReservation.reservedBuyCash.toFixed(2)).toBe('100.00');
    expect(afterSellReservation.availableCash.toFixed(2)).toBe('720.00');
    expect(afterSellReservation.instruments).toEqual([
      {
        instrumentId: 47,
        executedQuantity: 2,
        sellReservedQuantity: 1,
        availableQuantity: 1,
      },
    ]);
  });

  it('ignores REJECTED and CANCELLED orders and releases a reservation when NEW becomes CANCELLED', () => {
    const executed: AccountMovement[] = [
      filledCashIn(1, 1_000),
      {
        id: 2,
        instrumentId: 47,
        side: 'BUY',
        status: 'FILLED',
        size: 3,
        price: '100',
      },
      {
        id: 3,
        instrumentId: 47,
        side: 'SELL',
        status: 'FILLED',
        size: 1,
        price: '120',
      },
    ];
    const ignored: AccountMovement[] = [
      ...executed,
      {
        id: 4,
        instrumentId: 47,
        side: 'BUY',
        status: 'REJECTED',
        size: 100,
        price: '10',
      },
      {
        id: 5,
        instrumentId: 47,
        side: 'SELL',
        status: 'REJECTED',
        size: 10,
        price: '10',
      },
      {
        id: 6,
        instrumentId: 47,
        side: 'BUY',
        status: 'CANCELLED',
        size: 100,
        price: '10',
      },
      {
        id: 7,
        instrumentId: 47,
        side: 'SELL',
        status: 'CANCELLED',
        size: 10,
        price: '10',
      },
    ];

    expect(calculateAccountResources(ignored)).toEqual(
      calculateAccountResources(executed),
    );

    const cancelledReservation = calculateAccountResources([
      ...executed,
      {
        id: 8,
        instrumentId: 47,
        side: 'BUY',
        status: 'CANCELLED',
        size: 2,
        price: '50',
      },
      {
        id: 9,
        instrumentId: 47,
        side: 'SELL',
        status: 'CANCELLED',
        size: 1,
        price: null,
      },
    ]);

    expect(cancelledReservation.reservedBuyCash.toFixed(2)).toBe('0.00');
    expect(cancelledReservation.availableCash.toFixed(2)).toBe('820.00');
    expect(cancelledReservation.instruments).toEqual([
      {
        instrumentId: 47,
        executedQuantity: 2,
        sellReservedQuantity: 0,
        availableQuantity: 2,
      },
    ]);
  });

  it('keeps instruments and share reservations isolated per instrument', () => {
    const resources = calculateAccountResources([
      {
        id: 1,
        instrumentId: 47,
        side: 'BUY',
        status: 'FILLED',
        size: 10,
        price: '100',
      },
      {
        id: 2,
        instrumentId: 54,
        side: 'BUY',
        status: 'FILLED',
        size: 5,
        price: '200',
      },
      {
        id: 3,
        instrumentId: 47,
        side: 'SELL',
        status: 'NEW',
        size: 4,
        price: '150',
      },
    ]);

    expect(resources.instruments).toEqual([
      {
        instrumentId: 47,
        executedQuantity: 10,
        sellReservedQuantity: 4,
        availableQuantity: 6,
      },
      {
        instrumentId: 54,
        executedQuantity: 5,
        sellReservedQuantity: 0,
        availableQuantity: 5,
      },
    ]);
  });

  it('keeps decimal amounts exact for 3 x 0.10', () => {
    const resources = calculateAccountResources([
      filledCashIn(1, 1),
      {
        id: 2,
        instrumentId: 47,
        side: 'BUY',
        status: 'FILLED',
        size: 3,
        price: '0.10',
      },
      {
        id: 3,
        instrumentId: 47,
        side: 'BUY',
        status: 'NEW',
        size: 3,
        price: '0.10',
      },
    ]);

    expect(resources.accountingCash.equals(new Decimal('0.70'))).toBe(true);
    expect(resources.reservedBuyCash.equals(new Decimal('0.30'))).toBe(true);
    expect(resources.availableCash.equals(new Decimal('0.40'))).toBe(true);
    expect(resources.accountingCash.toFixed(2)).toBe('0.70');
    expect(resources.reservedBuyCash.toFixed(2)).toBe('0.30');
    expect(resources.availableCash.toFixed(2)).toBe('0.40');
  });

  it('keeps five maximum BUY NEW reservations exact', () => {
    const movements = Array.from({ length: 5 }, (_, index) =>
      maximumBuyNew(index + 1),
    );
    const expected = oracleCash(movements);

    expect(expected.reserved).toBe(FIVE_MAX_RESERVATION);
    expect(cashResources(movements)).toEqual({
      accounting: '0.00',
      reserved: FIVE_MAX_RESERVATION,
      available: '-1073741823392625817.65',
    });
    expect(cashResources(movements)).toEqual(expected);
    expect(calculateAccountResources(movements).instruments).toEqual([]);
  });

  it('computes mixed executions and transfers with exact cash and availability', () => {
    const movements = mixedMovements();

    expect(cashResources(movements)).toEqual({
      accounting: '-858993457948668544.12',
      reserved: '214748364678525163.53',
      available: '-1073741822627193707.65',
    });
    expect(cashResources(movements)).toEqual(oracleCash(movements));
    expect(calculateAccountResources(movements).instruments).toEqual([
      {
        instrumentId: 47,
        executedQuantity: 8_589_934_588,
        sellReservedQuantity: 7,
        availableQuantity: 8_589_934_581,
      },
    ]);
  });

  it('produces identical monetary results for permutations of the same movements', () => {
    const movements = mixedMovements();
    const expected = oracleCash(movements);
    const permutations = [
      movements,
      [...movements].reverse(),
      rotate(movements, 3),
      rotate(movements, 7),
      [9, 0, 7, 2, 5, 8, 1, 6, 3, 4].map(
        (index) => movements[index] as AccountMovement,
      ),
    ];

    for (const permutation of permutations) {
      expect(cashResources(permutation)).toEqual(expected);
    }
  });

  it('keeps large products and cents exact in the same account', () => {
    const movements: AccountMovement[] = [
      filledCashIn(1, MAX_SIZE),
      {
        id: 2,
        instrumentId: 47,
        side: 'BUY',
        status: 'FILLED',
        size: MAX_SIZE,
        price: MAX_PRICE,
      },
      {
        id: 3,
        instrumentId: 47,
        side: 'SELL',
        status: 'FILLED',
        size: 1,
        price: '0.10',
      },
      maximumBuyNew(4),
      {
        id: 5,
        instrumentId: 47,
        side: 'BUY',
        status: 'NEW',
        size: 3,
        price: '0.10',
      },
    ];
    const expected = oracleCash(movements);

    expect(cashResources(movements)).toEqual(expected);
    expect(expected.reserved).toBe('214748364678525163.83');
    expect(expected.accounting).toBe('-214748362531041516.43');
    expect(calculateAccountResources(movements).instruments).toEqual([
      {
        instrumentId: 47,
        executedQuantity: 2_147_483_646,
        sellReservedQuantity: 0,
        availableQuantity: 2_147_483_646,
      },
    ]);
  });

  it('does not modify the global Decimal configuration', () => {
    const before = globalDecimalConfig();

    calculateAccountResources(
      Array.from({ length: 5 }, (_, index) => maximumBuyNew(index + 1)),
    );

    expect(globalDecimalConfig()).toEqual(before);
  });

  it('preserves negative executed quantities without clamping or using NEW orders to correct them', () => {
    const resources = calculateAccountResources([
      {
        id: 1,
        instrumentId: 31,
        side: 'BUY',
        status: 'FILLED',
        size: 20,
        price: '1540',
      },
      {
        id: 2,
        instrumentId: 31,
        side: 'SELL',
        status: 'FILLED',
        size: 30,
        price: '1530',
      },
      {
        id: 3,
        instrumentId: 31,
        side: 'BUY',
        status: 'NEW',
        size: 60,
        price: '1500',
      },
    ]);

    expect(resources.instruments).toEqual([
      {
        instrumentId: 31,
        executedQuantity: -10,
        sellReservedQuantity: 0,
        availableQuantity: -10,
      },
    ]);
  });

  it('fails on movements whose required price is missing or invalid instead of using zero', () => {
    expect(() =>
      calculateAccountResources([
        {
          id: 1,
          instrumentId: 47,
          side: 'BUY',
          status: 'FILLED',
          size: 3,
          price: null,
        },
      ]),
    ).toThrow(InvalidAccountMovementError);

    expect(() =>
      calculateAccountResources([
        {
          id: 2,
          instrumentId: 47,
          side: 'BUY',
          status: 'NEW',
          size: 3,
          price: '0',
        },
      ]),
    ).toThrow(InvalidAccountMovementError);

    expect(() =>
      calculateAccountResources([
        {
          id: 3,
          instrumentId: CASH_INSTRUMENT_ID,
          side: 'CASH_IN',
          status: 'NEW',
          size: 10,
          price: '1',
        },
      ]),
    ).toThrow(InvalidAccountMovementError);
  });
});
