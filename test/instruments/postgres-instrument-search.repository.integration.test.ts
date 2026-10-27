import type { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PostgresInstrumentSearchRepository } from '../../src/instruments/infrastructure/persistence/postgres-instrument-search.repository.js';
import {
  insertInstruments,
  resetInstruments,
  type InstrumentFixture,
} from '../support/fixtures.js';
import { createTestPool } from '../support/test-database.js';

const FIRST_FIXTURE_ID = 1101;
const LAST_FIXTURE_ID = 1199;

const fixtures: InstrumentFixture[] = [
  {
    id: 1101,
    ticker: 'B01ADUP',
    name: 'B01ADUP Acciones',
    type: 'ACCIONES',
  },
  { id: 1102, ticker: 'B01ASAME', name: 'Primera', type: 'ACCIONES' },
  { id: 1103, ticker: 'B01ASAME', name: 'Segunda', type: 'ACCIONES' },
  { id: 1104, ticker: null, name: 'B01ANOMBRE', type: 'ACCIONES' },
  { id: 1105, ticker: 'B01ATICK', name: null, type: 'ACCIONES' },
  { id: 1106, ticker: 'B01AP100', name: 'Cien 100%', type: 'ACCIONES' },
  { id: 1107, ticker: 'B01AP100X', name: 'Cien 100X', type: 'ACCIONES' },
  { id: 1108, ticker: 'B01AA_B', name: 'Guion A_B', type: 'ACCIONES' },
  { id: 1109, ticker: 'B01AAXB', name: 'Guion AXB', type: 'ACCIONES' },
  { id: 1110, ticker: 'B01AWOW', name: 'Exclamacion !', type: 'ACCIONES' },
  {
    id: 1111,
    ticker: 'B01ASQL',
    name: "Robert'); DROP TABLE instruments;--",
    type: 'ACCIONES',
  },
  { id: 1112, ticker: 'B01MONT', name: 'Otra', type: 'MONEDA' },
  { id: 1113, ticker: 'OTRA', name: 'B01AMONEDAN', type: 'MONEDA' },
  { id: 1114, ticker: 'B01AAPL', name: 'Apple', type: 'ACCIONES' },
  { id: 1115, ticker: 'B01ASINCO', name: 'Sin cotizacion', type: 'ACCIONES' },
  { id: 1116, ticker: 'B01AORD2', name: 'Orden dos', type: 'ACCIONES' },
  { id: 1117, ticker: 'B01AORD1', name: 'Orden uno', type: 'ACCIONES' },
];

let pool: Pool;
let repository: PostgresInstrumentSearchRepository;

beforeAll(async () => {
  pool = createTestPool();
  await resetInstruments(pool, FIRST_FIXTURE_ID, LAST_FIXTURE_ID);
  await insertInstruments(pool, fixtures);
  repository = new PostgresInstrumentSearchRepository(pool);
});

afterAll(async () => {
  await resetInstruments(pool, FIRST_FIXTURE_ID, LAST_FIXTURE_ID);
  await pool.end();
});

describe('PostgresInstrumentSearchRepository against PostgreSQL', () => {
  it('matches ticker or name without duplicating a row', async () => {
    const rows = await repository.searchByText('B01ADUP');

    expect(rows).toEqual([
      { id: 1101, ticker: 'B01ADUP', name: 'B01ADUP Acciones' },
    ]);
  });

  it('uses ILIKE for case-insensitive matching', async () => {
    const rows = await repository.searchByText('b01adup');

    expect(rows).toEqual([
      { id: 1101, ticker: 'B01ADUP', name: 'B01ADUP Acciones' },
    ]);
  });

  it('orders equal tickers by id ascending', async () => {
    const rows = await repository.searchByText('B01ASAME');

    expect(rows.map((row) => row.id)).toEqual([1102, 1103]);
  });

  it('orders different tickers by ticker ascending', async () => {
    const rows = await repository.searchByText('B01AORD');

    expect(rows).toEqual([
      { id: 1117, ticker: 'B01AORD1', name: 'Orden uno' },
      { id: 1116, ticker: 'B01AORD2', name: 'Orden dos' },
    ]);
  });

  it('preserves null in ticker or name when the other field matches', async () => {
    await expect(repository.searchByText('B01ANOMBRE')).resolves.toEqual([
      { id: 1104, ticker: null, name: 'B01ANOMBRE' },
    ]);
    await expect(repository.searchByText('B01ATICK')).resolves.toEqual([
      { id: 1105, ticker: 'B01ATICK', name: null },
    ]);
  });

  it('treats percent as a literal character', async () => {
    const rows = await repository.searchByText('100%');

    expect(rows.map((row) => row.id)).toEqual([1106]);
  });

  it('treats underscore as a literal character', async () => {
    const rows = await repository.searchByText('A_B');

    expect(rows.map((row) => row.id)).toEqual([1108]);
  });

  it('treats the exclamation mark as a literal character', async () => {
    const rows = await repository.searchByText('!');

    expect(rows.map((row) => row.id)).toEqual([1110]);
  });

  it('does not interpret SQL-like text as SQL', async () => {
    const rows = await repository.searchByText(
      "Robert'); DROP TABLE instruments;--",
    );
    const count = await pool.query<{ count: number }>(
      'SELECT count(*)::int AS count FROM instruments',
    );

    expect(rows).toEqual([
      {
        id: 1111,
        ticker: 'B01ASQL',
        name: "Robert'); DROP TABLE instruments;--",
      },
    ]);
    expect(count.rows[0]?.count).toBeGreaterThan(0);
  });

  it('applies the ACCIONES filter to both sides of the OR', async () => {
    await expect(repository.searchByText('B01MONT')).resolves.toEqual([]);
    await expect(repository.searchByText('B01AMONEDAN')).resolves.toEqual([]);
  });

  it('excludes ARS and PESOS from results', async () => {
    await expect(repository.searchByText('ARS')).resolves.toEqual([]);
    await expect(repository.searchByText('PESOS')).resolves.toEqual([]);
  });

  it('finds an action without market data', async () => {
    const fixture = await repository.searchByText('B01ASINCO');
    const seed = await repository.searchByText('PGR');

    expect(fixture).toEqual([
      { id: 1115, ticker: 'B01ASINCO', name: 'Sin cotizacion' },
    ]);
    expect(seed).toEqual([
      { id: 3, ticker: 'PGR', name: 'Phoenix Global Resources' },
    ]);
  });

  it('does not turn a typo into a fuzzy match', async () => {
    await expect(repository.searchByText('appel')).resolves.toEqual([]);
    await expect(repository.searchByText('b01aapl')).resolves.toEqual([
      { id: 1114, ticker: 'B01AAPL', name: 'Apple' },
    ]);
  });

  it('finds seed PAMP by ticker through case-insensitive literal search', async () => {
    const rows = await repository.searchByText('pAmP');

    expect(rows).toEqual([
      { id: 47, ticker: 'PAMP', name: 'Pampa Holding S.A.' },
    ]);
  });

  it('does not modify orders while searching', async () => {
    const before = await pool.query<{ count: number }>(
      'SELECT count(*)::int AS count FROM orders',
    );

    await repository.searchByText('B01ADUP');

    const after = await pool.query<{ count: number }>(
      'SELECT count(*)::int AS count FROM orders',
    );

    expect(after.rows[0]?.count).toBe(before.rows[0]?.count);
  });
});
