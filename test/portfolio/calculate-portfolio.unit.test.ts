import { Decimal } from 'decimal.js';
import { describe, expect, it } from 'vitest';
import type { Instrument } from '../../src/instruments/domain/instrument.js';
import { calculatePortfolio } from '../../src/portfolio/domain/calculate-portfolio.js';
import { InvalidPortfolioDataError } from '../../src/portfolio/domain/invalid-portfolio-data.error.js';
import type {
  PortfolioMovement,
  PortfolioOrderType,
} from '../../src/portfolio/domain/portfolio-movement.js';
import type { PortfolioReadSnapshot } from '../../src/portfolio/domain/portfolio-read-snapshot.js';
import type { LatestQuote } from '../../src/quotes/domain/latest-quote.js';

const CASH_INSTRUMENT_ID = 66;
const DEFAULT_DATETIME = '2023-07-12 12:00:00.000001';

function cashIn(
  id: number,
  size: number,
  datetime = DEFAULT_DATETIME,
): PortfolioMovement {
  return order(id, CASH_INSTRUMENT_ID, 'CASH_IN', 'FILLED', size, '1', datetime);
}

function filledBuy(
  id: number,
  instrumentId: number,
  size: number,
  price: string,
  datetime = DEFAULT_DATETIME,
  type: PortfolioOrderType = 'MARKET',
): PortfolioMovement {
  return order(id, instrumentId, 'BUY', 'FILLED', size, price, datetime, type);
}

function filledSell(
  id: number,
  instrumentId: number,
  size: number,
  price: string,
  datetime = DEFAULT_DATETIME,
  type: PortfolioOrderType = 'MARKET',
): PortfolioMovement {
  return order(id, instrumentId, 'SELL', 'FILLED', size, price, datetime, type);
}

function order(
  id: number,
  instrumentId: number,
  side: PortfolioMovement['side'],
  status: PortfolioMovement['status'],
  size: number,
  price: string | null,
  datetime = DEFAULT_DATETIME,
  type: PortfolioOrderType = 'LIMIT',
): PortfolioMovement {
  return {
    id,
    instrumentId,
    side,
    status,
    size,
    price,
    type,
    datetime,
  };
}

function instrument(
  id: number,
  ticker: string | null = null,
  name: string | null = null,
): Instrument {
  return { id, ticker, name };
}

function quote(
  instrumentId: number,
  close: string | null,
  previousClose: string | null,
  id = instrumentId,
): LatestQuote {
  return {
    id,
    instrumentId,
    date: '2023-07-14',
    close,
    previousClose,
  };
}

function snapshot(
  movements: readonly PortfolioMovement[],
  instruments: readonly Instrument[] = [],
  quotes: readonly LatestQuote[] = [],
): PortfolioReadSnapshot {
  return { movements, instruments, quotes };
}

function positivePartialSaleSnapshot(quantity: number): PortfolioReadSnapshot {
  return snapshot(
    [
      cashIn(1, 20_000, '2023-07-12 10:00:00.000001'),
      filledBuy(2, 47, quantity, '0.99', '2023-07-12 10:01:00.000001'),
      filledBuy(3, 47, 1, '200.00', '2023-07-12 10:02:00.000001'),
      filledSell(4, 47, 1, '1.00', '2023-07-12 10:03:00.000001'),
    ],
    [instrument(47, 'PAMP', null)],
    [quote(47, '1.00', '1.00')],
  );
}

function negativePartialSaleSnapshot(quantity: number): PortfolioReadSnapshot {
  return snapshot(
    [
      cashIn(1, 20_000, '2023-07-12 10:00:00.000001'),
      filledBuy(2, 47, quantity - 1, '0.99', '2023-07-12 10:01:00.000001'),
      filledBuy(3, 47, 1, '201.98', '2023-07-12 10:02:00.000001'),
      filledSell(4, 47, 8, '1.00', '2023-07-12 10:03:00.000001'),
    ],
    [instrument(47, 'PAMP', null)],
    [quote(47, '1.00', '1.00')],
  );
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

describe('calculatePortfolio', () => {
  it('AC01 calculates moving-average cost, valuation, total return and account value', () => {
    const portfolio = calculatePortfolio(
      snapshot(
        [
          cashIn(1, 10_000, '2023-07-12 12:11:20.000001'),
          filledBuy(2, 47, 10, '100', '2023-07-12 12:31:20.000002'),
          filledBuy(3, 47, 10, '200', '2023-07-12 12:41:20.000003'),
          filledSell(4, 47, 5, '180', '2023-07-12 14:51:20.000004'),
        ],
        [instrument(47, 'PAMP', 'Pampa Holding S.A.')],
        [quote(47, '180', '175')],
      ),
    );

    expect(portfolio).toEqual({
      totalValue: '10600.00',
      availableCash: '7900.00',
      positions: [
        {
          instrumentId: 47,
          ticker: 'PAMP',
          name: 'Pampa Holding S.A.',
          quantity: 15,
          positionValue: '2700.00',
          totalReturnPercent: 20,
          dailyReturnPercent: 2.86,
        },
      ],
    });
  });

  it('subtracts BUY NEW reservations only from available cash and ignores SELL NEW executions', () => {
    const portfolio = calculatePortfolio(
      snapshot(
        [
          cashIn(1, 2_000),
          filledBuy(2, 47, 10, '100', '2023-07-12 12:01:00.000001'),
          order(3, 47, 'BUY', 'NEW', 3, '100', '2023-07-12 12:02:00.000001'),
          order(4, 47, 'SELL', 'NEW', 6, null, '2023-07-12 12:03:00.000001'),
          order(5, 47, 'BUY', 'REJECTED', 100, '100'),
          order(6, 47, 'SELL', 'CANCELLED', 10, '100'),
        ],
        [instrument(47, 'PAMP', 'Pampa Holding S.A.')],
        [quote(47, '120', '120')],
      ),
    );

    expect(portfolio).toEqual({
      totalValue: '2200.00',
      availableCash: '700.00',
      positions: [
        {
          instrumentId: 47,
          ticker: 'PAMP',
          name: 'Pampa Holding S.A.',
          quantity: 10,
          positionValue: '1200.00',
          totalReturnPercent: 20,
          dailyReturnPercent: 0,
        },
      ],
    });
  });

  it('accounts CASH_IN/CASH_OUT and ignores NEW, REJECTED and CANCELLED orders without needing quotes', () => {
    const portfolio = calculatePortfolio(
      snapshot([
        cashIn(1, 1_000),
        order(
          2,
          CASH_INSTRUMENT_ID,
          'CASH_OUT',
          'FILLED',
          200,
          '1',
          '2023-07-12 12:01:00.000001',
        ),
        order(3, 47, 'BUY', 'REJECTED', 5, '100'),
        order(4, 47, 'SELL', 'CANCELLED', 5, '100'),
        order(5, 47, 'BUY', 'NEW', 5, '10'),
        order(6, 47, 'SELL', 'NEW', 5, null),
      ]),
    );

    expect(portfolio).toEqual({
      totalValue: '800.00',
      availableCash: '750.00',
      positions: [],
    });
  });

  it('returns zero values and no positions for an existing account without movements', () => {
    expect(calculatePortfolio(snapshot([]))).toEqual({
      totalValue: '0.00',
      availableCash: '0.00',
      positions: [],
    });
  });

  it('returns cash-only portfolios without requiring instrument metadata or quotes', () => {
    expect(
      calculatePortfolio(
        snapshot([
          cashIn(1, 500),
          order(
            2,
            CASH_INSTRUMENT_ID,
            'CASH_OUT',
            'FILLED',
            100,
            '1',
            '2023-07-12 12:01:00.000001',
          ),
        ]),
      ),
    ).toEqual({
      totalValue: '400.00',
      availableCash: '400.00',
      positions: [],
    });
  });

  it('keeps a partial position and omits it after a valid full close', () => {
    const movements = [
      cashIn(1, 10_000, '2023-07-12 10:00:00.000001'),
      filledBuy(2, 47, 10, '100', '2023-07-12 10:01:00.000001'),
      filledSell(3, 47, 5, '180', '2023-07-12 10:02:00.000001'),
    ];

    const partial = calculatePortfolio(
      snapshot(
        movements,
        [instrument(47, 'PAMP', null)],
        [quote(47, '150', '150')],
      ),
    );

    expect(partial.positions).toEqual([
      {
        instrumentId: 47,
        ticker: 'PAMP',
        name: null,
        quantity: 5,
        positionValue: '750.00',
        totalReturnPercent: 50,
        dailyReturnPercent: 0,
      },
    ]);
    expect(partial.totalValue).toBe('10650.00');
    expect(partial.availableCash).toBe('9900.00');

    const closed = calculatePortfolio(
      snapshot([
        ...movements,
        filledSell(4, 47, 5, '180', '2023-07-12 10:03:00.000001'),
      ]),
    );

    expect(closed).toEqual({
      totalValue: '10800.00',
      availableCash: '10800.00',
      positions: [],
    });
  });

  it('processes the read sequence chronologically even when ids are not monotonic', () => {
    const portfolio = calculatePortfolio(
      snapshot(
        [
          filledBuy(99, 47, 10, '100', '2023-07-12 09:00:00.000001'),
          filledBuy(1, 47, 10, '200', '2023-07-12 10:00:00.000001'),
          filledSell(50, 47, 10, '180', '2023-07-12 11:00:00.000001'),
        ],
        [instrument(47, 'PAMP', null)],
        [quote(47, '180', '180')],
      ),
    );

    expect(portfolio.positions).toEqual([
      {
        instrumentId: 47,
        ticker: 'PAMP',
        name: null,
        quantity: 10,
        positionValue: '1800.00',
        totalReturnPercent: 20,
        dailyReturnPercent: 0,
      },
    ]);
  });

  it('preserves the supplied id order for equal timestamps', () => {
    const portfolio = calculatePortfolio(
      snapshot(
        [
          filledBuy(1, 47, 10, '100', '2023-07-12 10:00:00.000001'),
          filledSell(2, 47, 5, '180', '2023-07-12 10:00:00.000001'),
        ],
        [instrument(47, 'PAMP', null)],
        [quote(47, '100', '100')],
      ),
    );

    expect(portfolio.positions[0]).toMatchObject({
      quantity: 5,
      positionValue: '500.00',
      totalReturnPercent: 0,
    });
  });

  it('rounds exact +0.005% and -0.005% after a partial sale', () => {
    // Positive: (20000 × 0.99 + 1 × 200) / 20001 = 20000 / 20001.
    // Selling one share leaves Q = 20000 and the average cost unchanged, so
    // 100 × (1 / (20000 / 20001) - 1) = 100 × (20001 / 20000 - 1) = 1 / 200.
    const positive = calculatePortfolio(positivePartialSaleSnapshot(20_000));
    // Negative: (19998 × 0.99 + 1 × 201.98) / 19999 = 20000 / 19999.
    // Selling eight leaves Q = 19991 and the average cost unchanged, so
    // 100 × (1 / (20000 / 19999) - 1) = 100 × (19999 / 20000 - 1) = -1 / 200.
    const negative = calculatePortfolio(negativePartialSaleSnapshot(19_999));

    expect(positive).toEqual({
      totalValue: '20001.00',
      availableCash: '1.00',
      positions: [
        {
          instrumentId: 47,
          ticker: 'PAMP',
          name: null,
          quantity: 20_000,
          positionValue: '20000.00',
          totalReturnPercent: 0.01,
          dailyReturnPercent: 0,
        },
      ],
    });
    expect(negative).toEqual({
      totalValue: '19999.00',
      availableCash: '8.00',
      positions: [
        {
          instrumentId: 47,
          ticker: 'PAMP',
          name: null,
          quantity: 19_991,
          positionValue: '19991.00',
          totalReturnPercent: -0.01,
          dailyReturnPercent: 0,
        },
      ],
    });
  });

  it('rounds values immediately below and above the ±0.005% ties without tolerance', () => {
    // Positive family: average cost = (0.99 × quantity + 200) / (quantity + 1).
    // quantity 19999 returns 9900 / 1999901 ≈ +0.004950%; quantity 20000 is the
    // exact +0.005% tie; quantity 20001 returns 10100 / 2000099 ≈ +0.005050%.
    expect(
      calculatePortfolio(positivePartialSaleSnapshot(19_999)).positions[0]
        ?.totalReturnPercent,
    ).toBe(0);
    expect(
      calculatePortfolio(positivePartialSaleSnapshot(20_000)).positions[0]
        ?.totalReturnPercent,
    ).toBe(0.01);
    expect(
      calculatePortfolio(positivePartialSaleSnapshot(20_001)).positions[0]
        ?.totalReturnPercent,
    ).toBe(0.01);

    // Negative family: quantity 19998 returns -100 / 19801 ≈ -0.005050%;
    // quantity 19999 is the exact -0.005% tie; quantity 20000 returns
    // -9900 / 2000099 ≈ -0.004950%.
    expect(
      calculatePortfolio(negativePartialSaleSnapshot(19_998)).positions[0]
        ?.totalReturnPercent,
    ).toBe(-0.01);
    expect(
      calculatePortfolio(negativePartialSaleSnapshot(19_999)).positions[0]
        ?.totalReturnPercent,
    ).toBe(-0.01);
    expect(
      calculatePortfolio(negativePartialSaleSnapshot(20_000)).positions[0]
        ?.totalReturnPercent,
    ).toBe(0);
  });

  it('keeps exact average cost across successive partial sales and a later buy', () => {
    // After two buys: Q = 3 and C = 20, so the average cost is 20 / 3.
    // Both partial sales keep that average. The later buy of one at 10 changes
    // it to (20 / 3 + 10) / 2 = 25 / 3. A final sale leaves Q = 1, and close 10
    // gives 100 × (10 - 25 / 3) / (25 / 3) = 20%.
    const portfolio = calculatePortfolio(
      snapshot(
        [
          cashIn(1, 1_000, '2023-07-12 10:00:00.000001'),
          filledBuy(2, 47, 2, '5', '2023-07-12 10:01:00.000001'),
          filledBuy(3, 47, 1, '10', '2023-07-12 10:02:00.000001'),
          filledSell(4, 47, 1, '1', '2023-07-12 10:03:00.000001'),
          filledSell(5, 47, 1, '1', '2023-07-12 10:04:00.000001'),
          filledBuy(6, 47, 1, '10', '2023-07-12 10:05:00.000001'),
          filledSell(7, 47, 1, '1', '2023-07-12 10:06:00.000001'),
        ],
        [instrument(47, 'PAMP', null)],
        [quote(47, '10', '10')],
      ),
    );

    expect(portfolio).toEqual({
      totalValue: '983.00',
      availableCash: '973.00',
      positions: [
        {
          instrumentId: 47,
          ticker: 'PAMP',
          name: null,
          quantity: 1,
          positionValue: '10.00',
          totalReturnPercent: 20,
          dailyReturnPercent: 0,
        },
      ],
    });
  });

  it('keeps D03 negative quantity and value, returns null total return and does not rebuild cost after a later buy', () => {
    const negative = calculatePortfolio(
      snapshot(
        [
          cashIn(1, 100_000, '2023-07-13 10:00:00.000001'),
          filledBuy(2, 31, 20, '1540', '2023-07-13 12:51:20.000001'),
          filledSell(3, 31, 30, '1530', '2023-07-13 15:13:20.000001'),
        ],
        [instrument(31, null, null)],
        [quote(31, '1502.8', '1520.25')],
      ),
    );

    expect(negative).toEqual({
      totalValue: '100072.00',
      availableCash: '115100.00',
      positions: [
        {
          instrumentId: 31,
          ticker: null,
          name: null,
          quantity: -10,
          positionValue: '-15028.00',
          totalReturnPercent: null,
          dailyReturnPercent: -1.15,
        },
      ],
    });

    const afterBuy = calculatePortfolio(
      snapshot(
        [
          cashIn(1, 100_000, '2023-07-13 10:00:00.000001'),
          filledBuy(2, 31, 20, '1540', '2023-07-13 12:51:20.000001'),
          filledSell(3, 31, 30, '1530', '2023-07-13 15:13:20.000001'),
          filledBuy(4, 31, 15, '1500', '2023-07-14 10:00:00.000001'),
        ],
        [instrument(31, null, null)],
        [quote(31, '1502.8', '1520.25')],
      ),
    );

    expect(afterBuy.positions).toEqual([
      {
        instrumentId: 31,
        ticker: null,
        name: null,
        quantity: 5,
        positionValue: '7514.00',
        totalReturnPercent: null,
        dailyReturnPercent: -1.15,
      },
    ]);
    expect(afterBuy.totalValue).toBe('100114.00');
    expect(afterBuy.availableCash).toBe('92600.00');
  });

  it('calculates positive, negative and zero daily returns from the selected quote', () => {
    const cases = [
      { close: '110', previousClose: '100', expected: 10 },
      { close: '90', previousClose: '100', expected: -10 },
      { close: '100', previousClose: '100', expected: 0 },
    ] as const;

    for (const scenario of cases) {
      const portfolio = calculatePortfolio(
        snapshot(
          [filledBuy(1, 47, 1, '100')],
          [instrument(47, 'PAMP', null)],
          [quote(47, scenario.close, scenario.previousClose)],
        ),
      );

      expect(portfolio.positions[0]?.dailyReturnPercent).toBe(scenario.expected);
      expect(portfolio.positions).toHaveLength(1);
    }
  });

  it('returns a null daily return for a missing or invalid previous close without hiding the position', () => {
    const invalidBases = [null, '', '0', '-10', 'not-a-number', 'Infinity'];

    for (const previousClose of invalidBases) {
      const portfolio = calculatePortfolio(
        snapshot(
          [filledBuy(1, 47, 1, '100')],
          [instrument(47, 'PAMP', null)],
          [quote(47, '110', previousClose)],
        ),
      );

      expect(portfolio.positions).toHaveLength(1);
      expect(portfolio.positions[0]).toMatchObject({
        instrumentId: 47,
        quantity: 1,
        positionValue: '110.00',
        totalReturnPercent: 10,
        dailyReturnPercent: null,
      });
    }
  });

  it('fails the whole result when a required close is missing or invalid', () => {
    const invalidQuotes = [
      [],
      [quote(47, null, '100')],
      [quote(47, '', '100')],
      [quote(47, '0', '100')],
      [quote(47, '-1', '100')],
      [quote(47, 'not-a-number', '100')],
      [quote(47, 'Infinity', '100')],
    ];

    for (const quotes of invalidQuotes) {
      expect(() =>
        calculatePortfolio(
          snapshot(
            [filledBuy(1, 47, 1, '100')],
            [instrument(47, 'PAMP', null)],
            quotes,
          ),
        ),
      ).toThrow(InvalidPortfolioDataError);
    }
  });

  it('rejects missing or duplicated instrument metadata for a real position', () => {
    expect(() =>
      calculatePortfolio(
        snapshot([filledBuy(1, 47, 1, '100')], [], [quote(47, '100', '100')]),
      ),
    ).toThrow(InvalidPortfolioDataError);

    expect(() =>
      calculatePortfolio(
        snapshot(
          [filledBuy(1, 47, 1, '100')],
          [instrument(47, 'PAMP', null), instrument(47, 'PAMP', null)],
          [quote(47, '100', '100')],
        ),
      ),
    ).toThrow(InvalidPortfolioDataError);
  });

  it('does not fall back to another quote row when the latest quote is invalid or duplicated', () => {
    expect(() =>
      calculatePortfolio(
        snapshot(
          [filledBuy(1, 47, 1, '100')],
          [instrument(47, 'PAMP', null)],
          [quote(47, '100', '100', 1), quote(47, null, '100', 2)],
        ),
      ),
    ).toThrow(InvalidPortfolioDataError);
  });

  it('sorts positions by instrument id and preserves nullable ticker and name', () => {
    const portfolio = calculatePortfolio(
      snapshot(
        [
          filledBuy(1, 54, 1, '5', '2023-07-12 09:00:00.000001'),
          filledBuy(2, 31, 2, '5', '2023-07-12 10:00:00.000001'),
        ],
        [instrument(54, 'CAPX', null), instrument(31, null, null)],
        [quote(54, '20', '20'), quote(31, '10', '10')],
      ),
    );

    expect(portfolio.positions.map((position) => position.instrumentId)).toEqual(
      [31, 54],
    );
    expect(portfolio.positions).toEqual([
      {
        instrumentId: 31,
        ticker: null,
        name: null,
        quantity: 2,
        positionValue: '20.00',
        totalReturnPercent: 100,
        dailyReturnPercent: 0,
      },
      {
        instrumentId: 54,
        ticker: 'CAPX',
        name: null,
        quantity: 1,
        positionValue: '20.00',
        totalReturnPercent: 300,
        dailyReturnPercent: 0,
      },
    ]);
  });

  it('includes FILLED BUY and SELL executions regardless of MARKET or LIMIT type', () => {
    const portfolio = calculatePortfolio(
      snapshot(
        [
          cashIn(1, 10_000),
          filledBuy(2, 47, 10, '100', '2023-07-12 10:00:00.000001', 'MARKET'),
          filledBuy(3, 47, 10, '200', '2023-07-12 10:01:00.000001', 'LIMIT'),
          filledSell(4, 47, 5, '180', '2023-07-12 10:02:00.000001', 'LIMIT'),
        ],
        [instrument(47, 'PAMP', null)],
        [quote(47, '180', '180')],
      ),
    );

    expect(portfolio.positions).toEqual([
      {
        instrumentId: 47,
        ticker: 'PAMP',
        name: null,
        quantity: 15,
        positionValue: '2700.00',
        totalReturnPercent: 20,
        dailyReturnPercent: 0,
      },
    ]);
  });

  it('keeps non-terminating cost divisions without rounding cost to cents on each sale', () => {
    const portfolio = calculatePortfolio(
      snapshot(
        [
          filledBuy(1, 47, 2, '5', '2023-07-12 10:00:00.000001'),
          filledBuy(2, 47, 1, '10', '2023-07-12 10:01:00.000001'),
          filledSell(3, 47, 1, '7', '2023-07-12 10:02:00.000001'),
          filledSell(4, 47, 1, '7', '2023-07-12 10:03:00.000001'),
        ],
        [instrument(47, 'PAMP', null)],
        [quote(47, '10', '10')],
      ),
    );

    expect(portfolio.positions).toEqual([
      {
        instrumentId: 47,
        ticker: 'PAMP',
        name: null,
        quantity: 1,
        positionValue: '10.00',
        totalReturnPercent: 50,
        dailyReturnPercent: 0,
      },
    ]);
  });

  it('keeps exact aggregates with more than 20 significant digits', () => {
    const size = 2_147_483_647;
    const price = '99999999.99';
    const movements = Array.from({ length: 5 }, (_, index) =>
      filledBuy(
        index + 1,
        47,
        size,
        price,
        `2023-07-12 10:0${index}:00.000001`,
      ),
    );
    const portfolio = calculatePortfolio(
      snapshot(
        movements,
        [instrument(47, 'PAMP', null)],
        [quote(47, price, price)],
      ),
    );

    expect(portfolio).toEqual({
      totalValue: '0.00',
      availableCash: '-1073741823392625817.65',
      positions: [
        {
          instrumentId: 47,
          ticker: 'PAMP',
          name: null,
          quantity: 10_737_418_235,
          positionValue: '1073741823392625817.65',
          totalReturnPercent: 0,
          dailyReturnPercent: 0,
        },
      ],
    });
  });

  it('rounds presentation ties half up for positive and negative returns', () => {
    const positive = calculatePortfolio(
      snapshot(
        [filledBuy(1, 47, 1, '10000')],
        [instrument(47, 'PAMP', null)],
        [quote(47, '10000.50', '10000.50')],
      ),
    );
    const negative = calculatePortfolio(
      snapshot(
        [filledBuy(1, 47, 1, '10000')],
        [instrument(47, 'PAMP', null)],
        [quote(47, '9999.50', '9999.50')],
      ),
    );

    expect(positive.positions[0]).toMatchObject({
      positionValue: '10000.50',
      totalReturnPercent: 0.01,
      dailyReturnPercent: 0,
    });
    expect(negative.positions[0]).toMatchObject({
      positionValue: '9999.50',
      totalReturnPercent: -0.01,
      dailyReturnPercent: 0,
    });
  });

  it('rounds daily presentation ties half up for positive and negative values', () => {
    const positive = calculatePortfolio(
      snapshot(
        [filledBuy(1, 47, 1, '100')],
        [instrument(47, 'PAMP', null)],
        [quote(47, '100.005', '100')],
      ),
    );
    const negative = calculatePortfolio(
      snapshot(
        [filledBuy(1, 47, 1, '100')],
        [instrument(47, 'PAMP', null)],
        [quote(47, '99.995', '100')],
      ),
    );

    expect(positive.positions[0]?.dailyReturnPercent).toBe(0.01);
    expect(positive.positions[0]?.totalReturnPercent).toBe(0.01);
    expect(negative.positions[0]?.dailyReturnPercent).toBe(-0.01);
    expect(negative.positions[0]?.totalReturnPercent).toBe(-0.01);
  });

  it('does not modify the global Decimal configuration', () => {
    const before = globalDecimalConfig();

    calculatePortfolio(
      snapshot(
        [
          filledBuy(1, 47, 2, '5', '2023-07-12 10:00:00.000001'),
          filledBuy(2, 47, 1, '10', '2023-07-12 10:01:00.000001'),
          filledSell(3, 47, 1, '7', '2023-07-12 10:02:00.000001'),
        ],
        [instrument(47, 'PAMP', null)],
        [quote(47, '10', '10')],
      ),
    );

    expect(globalDecimalConfig()).toEqual(before);
  });
});
