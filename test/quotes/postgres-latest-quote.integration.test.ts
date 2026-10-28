import { Test, type TestingModule } from '@nestjs/testing';
import type { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AppModule } from '../../src/app.module.js';
import type { LatestQuoteRepository } from '../../src/quotes/application/ports/out/latest-quote.repository.js';
import { LATEST_QUOTE_REPOSITORY } from '../../src/quotes/quotes.tokens.js';
import { createTestPool } from '../support/test-database.js';

const FIRST_FIXTURE_ID = 3101;
const LAST_FIXTURE_ID = 3199;

const DATE_INSTRUMENT_ID = 3101;
const TIE_INSTRUMENT_ID = 3102;
const NULL_DATE_INSTRUMENT_ID = 3103;
const NO_QUOTE_INSTRUMENT_ID = 3104;
const ALL_NULL_DATES_INSTRUMENT_ID = 3105;
const NULL_CLOSE_INSTRUMENT_ID = 3106;
const ZERO_CLOSE_INSTRUMENT_ID = 3107;
const NEGATIVE_CLOSE_INSTRUMENT_ID = 3108;
const NULL_PREVIOUS_CLOSE_INSTRUMENT_ID = 3109;
const EXACT_DECIMAL_INSTRUMENT_ID = 3110;
const OTHER_INSTRUMENT_ID = 3111;
const FIVE_DIGIT_YEAR_INSTRUMENT_ID = 3112;

interface InstrumentFixture {
  id: number;
  ticker: string;
}

interface QuoteFixture {
  id: number;
  instrumentId: number;
  date: string | null;
  close: string | null;
  previousClose: string | null;
}

const instruments: readonly InstrumentFixture[] = [
  { id: DATE_INSTRUMENT_ID, ticker: 'B03D' },
  { id: TIE_INSTRUMENT_ID, ticker: 'B03T' },
  { id: NULL_DATE_INSTRUMENT_ID, ticker: 'B03ND' },
  { id: NO_QUOTE_INSTRUMENT_ID, ticker: 'B03N' },
  { id: ALL_NULL_DATES_INSTRUMENT_ID, ticker: 'B03AN' },
  { id: NULL_CLOSE_INSTRUMENT_ID, ticker: 'B03NC' },
  { id: ZERO_CLOSE_INSTRUMENT_ID, ticker: 'B03Z' },
  { id: NEGATIVE_CLOSE_INSTRUMENT_ID, ticker: 'B03NEG' },
  { id: NULL_PREVIOUS_CLOSE_INSTRUMENT_ID, ticker: 'B03NP' },
  { id: EXACT_DECIMAL_INSTRUMENT_ID, ticker: 'B03EX' },
  { id: OTHER_INSTRUMENT_ID, ticker: 'B03O' },
  { id: FIVE_DIGIT_YEAR_INSTRUMENT_ID, ticker: 'B03Y' },
];

const quotes: readonly QuoteFixture[] = [
  {
    id: 3191,
    instrumentId: DATE_INSTRUMENT_ID,
    date: '2023-07-13',
    close: '999.99',
    previousClose: '888.88',
  },
  {
    id: 3101,
    instrumentId: DATE_INSTRUMENT_ID,
    date: '2023-07-14',
    close: '1.23',
    previousClose: '2.34',
  },
  {
    id: 3102,
    instrumentId: TIE_INSTRUMENT_ID,
    date: '2023-07-20',
    close: '10.00',
    previousClose: '9.00',
  },
  {
    id: 3192,
    instrumentId: TIE_INSTRUMENT_ID,
    date: '2023-07-20',
    close: '20.00',
    previousClose: '19.00',
  },
  {
    id: 3103,
    instrumentId: NULL_DATE_INSTRUMENT_ID,
    date: '2020-01-01',
    close: '5.00',
    previousClose: '4.00',
  },
  {
    id: 3193,
    instrumentId: NULL_DATE_INSTRUMENT_ID,
    date: null,
    close: '99.99',
    previousClose: '98.00',
  },
  {
    id: 3105,
    instrumentId: ALL_NULL_DATES_INSTRUMENT_ID,
    date: null,
    close: '1.00',
    previousClose: '1.00',
  },
  {
    id: 3195,
    instrumentId: ALL_NULL_DATES_INSTRUMENT_ID,
    date: null,
    close: '2.00',
    previousClose: '2.00',
  },
  {
    id: 3106,
    instrumentId: NULL_CLOSE_INSTRUMENT_ID,
    date: '2023-08-01',
    close: null,
    previousClose: '7.77',
  },
  {
    id: 3196,
    instrumentId: NULL_CLOSE_INSTRUMENT_ID,
    date: '2023-07-01',
    close: '8.88',
    previousClose: '1.11',
  },
  {
    id: 3107,
    instrumentId: ZERO_CLOSE_INSTRUMENT_ID,
    date: '2023-08-02',
    close: '0.00',
    previousClose: '1.00',
  },
  {
    id: 3197,
    instrumentId: ZERO_CLOSE_INSTRUMENT_ID,
    date: '2023-07-01',
    close: '10.00',
    previousClose: '9.00',
  },
  {
    id: 3108,
    instrumentId: NEGATIVE_CLOSE_INSTRUMENT_ID,
    date: '2023-08-03',
    close: '-5.00',
    previousClose: '1.00',
  },
  {
    id: 3198,
    instrumentId: NEGATIVE_CLOSE_INSTRUMENT_ID,
    date: '2023-07-01',
    close: '10.00',
    previousClose: '9.00',
  },
  {
    id: 3109,
    instrumentId: NULL_PREVIOUS_CLOSE_INSTRUMENT_ID,
    date: '2023-08-04',
    close: '12.34',
    previousClose: null,
  },
  {
    id: 3110,
    instrumentId: EXACT_DECIMAL_INSTRUMENT_ID,
    date: '2023-07-14',
    close: '12345678.90',
    previousClose: '0.10',
  },
  {
    id: 3111,
    instrumentId: OTHER_INSTRUMENT_ID,
    date: '2023-07-15',
    close: '44.44',
    previousClose: '40.00',
  },
  {
    id: 3194,
    instrumentId: FIVE_DIGIT_YEAR_INSTRUMENT_ID,
    date: '9999-12-31',
    close: '1.00',
    previousClose: '0.90',
  },
  {
    id: 3112,
    instrumentId: FIVE_DIGIT_YEAR_INSTRUMENT_ID,
    date: '10000-01-01',
    close: '2.00',
    previousClose: '1.00',
  },
];

let pool: Pool;
let moduleRef: TestingModule | undefined;
let repository: LatestQuoteRepository;
let seedQuoteCount = 0;
let seedOrderCount = 0;

beforeAll(async () => {
  pool = createTestPool();
  await resetFixtures(pool);

  const quoteCount = await pool.query<{ count: number }>(
    `SELECT count(*)::int AS count
       FROM marketdata
      WHERE instrumentid < $1`,
    [FIRST_FIXTURE_ID],
  );
  seedQuoteCount = quoteCount.rows[0]?.count ?? 0;

  const orderCount = await pool.query<{ count: number }>(
    'SELECT count(*)::int AS count FROM orders',
  );
  seedOrderCount = orderCount.rows[0]?.count ?? 0;

  for (const instrument of instruments) {
    await pool.query(
      `INSERT INTO instruments (id, ticker, name, type)
       VALUES ($1, $2, $3, 'ACCIONES')`,
      [
        instrument.id,
        instrument.ticker,
        `B03 fixture ${instrument.ticker}`,
      ],
    );
  }

  for (const quote of quotes) {
    await pool.query(
      `INSERT INTO marketdata
         (id, instrumentid, date, close, previousclose)
       VALUES ($1, $2, $3, $4, $5)`,
      [
        quote.id,
        quote.instrumentId,
        quote.date,
        quote.close,
        quote.previousClose,
      ],
    );
  }

  moduleRef = await Test.createTestingModule({
    imports: [AppModule],
  }).compile();
  await moduleRef.init();
  repository = moduleRef.get<LatestQuoteRepository>(LATEST_QUOTE_REPOSITORY);
});

afterAll(async () => {
  await resetFixtures(pool);
  await moduleRef?.close();
  await pool.end();
});

describe('Postgres latest quote against PostgreSQL', () => {
  it('is composed from the application module and the existing pool', () => {
    expect(repository).toBeDefined();
    expect(moduleRef?.get(LATEST_QUOTE_REPOSITORY)).toBe(repository);
  });

  it('selects the greatest non-null date even when it has a lower id and price', async () => {
    await expect(
      repository.findLatestByInstrumentId(DATE_INSTRUMENT_ID),
    ).resolves.toEqual({
      id: 3101,
      instrumentId: DATE_INSTRUMENT_ID,
      date: '2023-07-14',
      close: '1.23',
      previousClose: '2.34',
    });
  });

  it('selects the greatest native date instead of the formatted calendar text', async () => {
    await expect(
      repository.findLatestByInstrumentId(FIVE_DIGIT_YEAR_INSTRUMENT_ID),
    ).resolves.toEqual({
      id: 3112,
      instrumentId: FIVE_DIGIT_YEAR_INSTRUMENT_ID,
      date: '10000-01-01',
      close: '2.00',
      previousClose: '1.00',
    });
  });

  it('selects the greatest id for the same instrument and date', async () => {
    await expect(
      repository.findLatestByInstrumentId(TIE_INSTRUMENT_ID),
    ).resolves.toEqual({
      id: 3192,
      instrumentId: TIE_INSTRUMENT_ID,
      date: '2023-07-20',
      close: '20.00',
      previousClose: '19.00',
    });
  });

  it('excludes a null date even when its id is greater', async () => {
    await expect(
      repository.findLatestByInstrumentId(NULL_DATE_INSTRUMENT_ID),
    ).resolves.toEqual({
      id: 3103,
      instrumentId: NULL_DATE_INSTRUMENT_ID,
      date: '2020-01-01',
      close: '5.00',
      previousClose: '4.00',
    });
  });

  it('returns an internal absence without rows or with only null dates', async () => {
    await expect(
      repository.findLatestByInstrumentId(NO_QUOTE_INSTRUMENT_ID),
    ).resolves.toBeNull();
    await expect(
      repository.findLatestByInstrumentId(ALL_NULL_DATES_INSTRUMENT_ID),
    ).resolves.toBeNull();
  });

  it('keeps a selected row with null close instead of falling back to an older row', async () => {
    await expect(
      repository.findLatestByInstrumentId(NULL_CLOSE_INSTRUMENT_ID),
    ).resolves.toEqual({
      id: 3106,
      instrumentId: NULL_CLOSE_INSTRUMENT_ID,
      date: '2023-08-01',
      close: null,
      previousClose: '7.77',
    });
  });

  it('keeps zero and negative close values from the selected row', async () => {
    await expect(
      repository.findLatestByInstrumentId(ZERO_CLOSE_INSTRUMENT_ID),
    ).resolves.toEqual({
      id: 3107,
      instrumentId: ZERO_CLOSE_INSTRUMENT_ID,
      date: '2023-08-02',
      close: '0.00',
      previousClose: '1.00',
    });
    await expect(
      repository.findLatestByInstrumentId(NEGATIVE_CLOSE_INSTRUMENT_ID),
    ).resolves.toEqual({
      id: 3108,
      instrumentId: NEGATIVE_CLOSE_INSTRUMENT_ID,
      date: '2023-08-03',
      close: '-5.00',
      previousClose: '1.00',
    });
  });

  it('keeps a null previousClose without substituting close or another row', async () => {
    await expect(
      repository.findLatestByInstrumentId(NULL_PREVIOUS_CLOSE_INSTRUMENT_ID),
    ).resolves.toEqual({
      id: 3109,
      instrumentId: NULL_PREVIOUS_CLOSE_INSTRUMENT_ID,
      date: '2023-08-04',
      close: '12.34',
      previousClose: null,
    });
  });

  it('keeps exact decimal text, calendar dates and instrument isolation', async () => {
    const exact = await repository.findLatestByInstrumentId(
      EXACT_DECIMAL_INSTRUMENT_ID,
    );
    const other = await repository.findLatestByInstrumentId(OTHER_INSTRUMENT_ID);

    expect(exact).toEqual({
      id: 3110,
      instrumentId: EXACT_DECIMAL_INSTRUMENT_ID,
      date: '2023-07-14',
      close: '12345678.90',
      previousClose: '0.10',
    });
    expect(other).toEqual({
      id: 3111,
      instrumentId: OTHER_INSTRUMENT_ID,
      date: '2023-07-15',
      close: '44.44',
      previousClose: '40.00',
    });
  });

  it('reads the seed and leaves orders and seed quotes unchanged', async () => {
    await expect(repository.findLatestByInstrumentId(12)).resolves.toEqual({
      id: 65,
      instrumentId: 12,
      date: '2023-07-14',
      close: '20.50',
      previousClose: '20.50',
    });

    const quoteCount = await pool.query<{ count: number }>(
      `SELECT count(*)::int AS count
         FROM marketdata
        WHERE instrumentid < $1`,
      [FIRST_FIXTURE_ID],
    );
    const orderCount = await pool.query<{ count: number }>(
      'SELECT count(*)::int AS count FROM orders',
    );

    expect(quoteCount.rows[0]?.count).toBe(seedQuoteCount);
    expect(orderCount.rows[0]?.count).toBe(seedOrderCount);
  });
});

async function resetFixtures(target: Pool): Promise<void> {
  await target.query(
    'DELETE FROM marketdata WHERE id BETWEEN $1 AND $2',
    [FIRST_FIXTURE_ID, LAST_FIXTURE_ID],
  );
  await target.query(
    'DELETE FROM instruments WHERE id BETWEEN $1 AND $2',
    [FIRST_FIXTURE_ID, LAST_FIXTURE_ID],
  );
}
