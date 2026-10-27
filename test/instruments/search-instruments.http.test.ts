import type { INestApplication } from '@nestjs/common';
import type { Pool } from 'pg';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PG_POOL } from '../../src/database/database.tokens.js';
import { createTestApplication } from '../support/test-app.js';
import {
  insertInstruments,
  resetInstruments,
  type InstrumentFixture,
} from '../support/fixtures.js';

const FIRST_FIXTURE_ID = 1001;
const LAST_FIXTURE_ID = 1099;

const longName = `B01LEN${'a'.repeat(249)}`;

const fixtures: InstrumentFixture[] = [
  {
    id: 1001,
    ticker: 'B01DUP',
    name: 'B01DUP Acciones',
    type: 'ACCIONES',
  },
  { id: 1002, ticker: 'B01SAME', name: 'Primera', type: 'ACCIONES' },
  { id: 1003, ticker: 'B01SAME', name: 'Segunda', type: 'ACCIONES' },
  { id: 1004, ticker: 'B01SINCO', name: 'Sin cotizacion', type: 'ACCIONES' },
  { id: 1005, ticker: null, name: 'B01NOMBRE', type: 'ACCIONES' },
  { id: 1006, ticker: 'B01TICK', name: null, type: 'ACCIONES' },
  { id: 1007, ticker: 'B01MONEDAT', name: 'Otra', type: 'MONEDA' },
  { id: 1008, ticker: 'OTRA', name: 'B01MONEDAN', type: 'MONEDA' },
  { id: 1009, ticker: 'B01LEN', name: longName, type: 'ACCIONES' },
  { id: 1010, ticker: 'B01AST', name: 'Astral 😀', type: 'ACCIONES' },
  {
    id: 1011,
    ticker: 'B01SQL',
    name: "Robert'); DROP TABLE instruments;--",
    type: 'ACCIONES',
  },
  { id: 1012, ticker: 'B01PCT', name: 'Cien 100%', type: 'ACCIONES' },
  { id: 1013, ticker: 'B01P100X', name: 'Cien 100X', type: 'ACCIONES' },
  { id: 1014, ticker: 'B01A_B', name: 'Guion A_B', type: 'ACCIONES' },
  { id: 1015, ticker: 'B01AXB', name: 'Guion AXB', type: 'ACCIONES' },
  { id: 1016, ticker: 'B01WOW', name: 'Wow!', type: 'ACCIONES' },
  { id: 1017, ticker: 'B01AAPL', name: 'Apple', type: 'ACCIONES' },
  { id: 1018, ticker: 'B01ONE', name: 'x', type: 'ACCIONES' },
  { id: 1019, ticker: 'B01ORD2', name: 'Orden dos', type: 'ACCIONES' },
  { id: 1020, ticker: 'B01ORD1', name: 'Orden uno', type: 'ACCIONES' },
];

let app: INestApplication;
let pool: Pool;

beforeAll(async () => {
  app = await createTestApplication();
  pool = app.get<Pool>(PG_POOL);
  await resetInstruments(pool, FIRST_FIXTURE_ID, LAST_FIXTURE_ID);
  await insertInstruments(pool, fixtures);
});

afterAll(async () => {
  await resetInstruments(pool, FIRST_FIXTURE_ID, LAST_FIXTURE_ID);
  await app.close();
});

function httpServer(): Parameters<typeof request>[0] {
  return app.getHttpServer() as Parameters<typeof request>[0];
}

describe('GET /instruments against PostgreSQL', () => {
  it('finds PAMP by ticker with trim and mixed case', async () => {
    const response = await request(httpServer())
      .get('/instruments')
      .query({ query: ' pAmP ' })
      .expect(200);

    expect(response.body).toEqual([
      { id: 47, ticker: 'PAMP', name: 'Pampa Holding S.A.' },
    ]);
  });

  it('finds PAMP by name', async () => {
    const response = await request(httpServer())
      .get('/instruments?query=holding')
      .expect(200);

    expect(response.body).toEqual(
      expect.arrayContaining([
        { id: 47, ticker: 'PAMP', name: 'Pampa Holding S.A.' },
      ]),
    );
  });

  it('returns only id, ticker and name', async () => {
    const response = await request(httpServer())
      .get('/instruments?query=PAMP')
      .expect(200);

    expect(Object.keys(response.body[0] as object).sort()).toEqual([
      'id',
      'name',
      'ticker',
    ]);
    expect(response.body[0]).not.toHaveProperty('type');
  });

  it('returns 200 with an empty collection when nothing matches', async () => {
    const response = await request(httpServer())
      .get('/instruments?query=zzzz-no-match')
      .expect(200);

    expect(response.body).toEqual([]);
  });

  it('excludes ARS and PESOS from search', async () => {
    const ars = await request(httpServer())
      .get('/instruments?query=ARS')
      .expect(200);
    const pesos = await request(httpServer())
      .get('/instruments?query=PESOS')
      .expect(200);

    expect(ars.body).toEqual([]);
    expect(pesos.body).toEqual([]);
  });

  it('finds an action without market data', async () => {
    const seed = await request(httpServer())
      .get('/instruments?query=PGR')
      .expect(200);
    const fixture = await request(httpServer())
      .get('/instruments?query=B01SINCO')
      .expect(200);

    expect(seed.body).toEqual([
      { id: 3, ticker: 'PGR', name: 'Phoenix Global Resources' },
    ]);
    expect(fixture.body).toEqual([
      { id: 1004, ticker: 'B01SINCO', name: 'Sin cotizacion' },
    ]);
  });

  it('applies the ACCIONES filter to both sides of the OR', async () => {
    const ticker = await request(httpServer())
      .get('/instruments?query=B01MONEDAT')
      .expect(200);
    const name = await request(httpServer())
      .get('/instruments?query=B01MONEDAN')
      .expect(200);

    expect(ticker.body).toEqual([]);
    expect(name.body).toEqual([]);
  });

  it('returns a single row when ticker and name both match', async () => {
    const response = await request(httpServer())
      .get('/instruments?query=B01DUP')
      .expect(200);

    expect(response.body).toEqual([
      { id: 1001, ticker: 'B01DUP', name: 'B01DUP Acciones' },
    ]);
  });

  it('orders by ticker and then by id', async () => {
    const sameTicker = await request(httpServer())
      .get('/instruments?query=B01SAME')
      .expect(200);
    const differentTickers = await request(httpServer())
      .get('/instruments?query=B01ORD')
      .expect(200);

    expect(sameTicker.body.map((row: { id: number }) => row.id)).toEqual([
      1002, 1003,
    ]);
    expect(
      differentTickers.body.map((row: { ticker: string }) => row.ticker),
    ).toEqual(['B01ORD1', 'B01ORD2']);
  });

  it('preserves null in ticker or name', async () => {
    const byName = await request(httpServer())
      .get('/instruments?query=B01NOMBRE')
      .expect(200);
    const byTicker = await request(httpServer())
      .get('/instruments?query=B01TICK')
      .expect(200);

    expect(byName.body).toEqual([
      { id: 1005, ticker: null, name: 'B01NOMBRE' },
    ]);
    expect(byTicker.body).toEqual([
      { id: 1006, ticker: 'B01TICK', name: null },
    ]);
  });

  it('searches percent, underscore and exclamation as literal characters', async () => {
    const percent = await request(httpServer())
      .get('/instruments?query=100%25')
      .expect(200);
    const underscore = await request(httpServer())
      .get('/instruments?query=A_B')
      .expect(200);
    const exclamation = await request(httpServer())
      .get('/instruments?query=%21')
      .expect(200);

    expect(percent.body.map((row: { id: number }) => row.id)).toEqual([1012]);
    expect(underscore.body.map((row: { id: number }) => row.id)).toEqual([
      1014,
    ]);
    expect(exclamation.body.map((row: { id: number }) => row.id)).toEqual([
      1016,
    ]);
  });

  it('does not execute SQL-like text', async () => {
    const query = "Robert'); DROP TABLE instruments;--";
    const response = await request(httpServer())
      .get('/instruments')
      .query({ query })
      .expect(200);
    const after = await request(httpServer())
      .get('/instruments?query=PAMP')
      .expect(200);

    expect(response.body).toEqual([
      {
        id: 1011,
        ticker: 'B01SQL',
        name: "Robert'); DROP TABLE instruments;--",
      },
    ]);
    expect(after.body).toHaveLength(1);
  });

  it('accepts 255 Unicode characters after trim and rejects 256', async () => {
    const accepted = await request(httpServer())
      .get('/instruments')
      .query({ query: ` ${longName} ` })
      .expect(200);
    const rejected = await request(httpServer())
      .get('/instruments')
      .query({ query: `${longName}a` })
      .expect(400);
    const rejectedWithSpaces = await request(httpServer())
      .get('/instruments')
      .query({ query: ` ${longName}a ` })
      .expect(400);

    expect(accepted.body).toEqual([
      { id: 1009, ticker: 'B01LEN', name: longName },
    ]);
    expect(rejected.body).toEqual({ message: 'Invalid request.' });
    expect(rejectedWithSpaces.body).toEqual({ message: 'Invalid request.' });
  });

  it('counts astral characters as one Unicode character', async () => {
    const accepted = await request(httpServer())
      .get('/instruments')
      .query({ query: '😀'.repeat(255) })
      .expect(200);
    const rejected = await request(httpServer())
      .get('/instruments')
      .query({ query: '😀'.repeat(256) })
      .expect(400);
    const match = await request(httpServer())
      .get('/instruments?query=%F0%9F%98%80')
      .expect(200);

    expect(accepted.body).toEqual([]);
    expect(rejected.body).toEqual({ message: 'Invalid request.' });
    expect(match.body).toEqual([
      { id: 1010, ticker: 'B01AST', name: 'Astral 😀' },
    ]);
  });

  it('accepts numeric text as a valid query', async () => {
    const response = await request(httpServer())
      .get('/instruments?query=123')
      .expect(200);

    expect(response.body).toEqual([]);
  });

  it('allows a single-character query', async () => {
    const response = await request(httpServer())
      .get('/instruments?query=x')
      .expect(200);

    expect(response.body).toEqual(
      expect.arrayContaining([
        { id: 1018, ticker: 'B01ONE', name: 'x' },
      ]),
    );
  });

  it('returns a generic 400 for repeated or structured query parameters', async () => {
    const paths = [
      '/instruments?query=PAMP&query=DYCA',
      '/instruments?query%5Ba%5D=PAMP',
      '/instruments?query%5B%5D=PAMP',
      '/instruments?query=PAMP&query%5Ba%5D=DYCA',
    ];

    for (const path of paths) {
      const response = await request(httpServer()).get(path).expect(400);

      expect(response.body).toEqual({ message: 'Invalid request.' });
    }
  });
});
