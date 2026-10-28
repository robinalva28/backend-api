import { Test, type TestingModule } from '@nestjs/testing';
import type { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AppModule } from '../../src/app.module.js';
import type { AccountMovementRepository } from '../../src/resources/application/ports/out/account-movement.repository.js';
import type { GetAccountResourcesUseCase } from '../../src/resources/application/ports/in/get-account-resources.use-case.js';
import { ACCOUNT_MOVEMENT_REPOSITORY, GET_ACCOUNT_RESOURCES_USE_CASE } from '../../src/resources/resources.tokens.js';
import { createTestPool } from '../support/test-database.js';

const FIRST_USER_ID = 2101;
const SECOND_USER_ID = 2102;
const LIMIT_USER_ID = 2103;
const FIRST_INSTRUMENT_ID = 2101;
const LAST_INSTRUMENT_ID = 2104;
const CASH_INSTRUMENT_ID = 2104;
const MAX_SIZE = 2_147_483_647;
const MAX_PRICE = '99999999.99';

interface FixtureOrder {
  instrumentId: number;
  userId: number;
  size: number;
  price: string | null;
  side: 'BUY' | 'SELL' | 'CASH_IN' | 'CASH_OUT';
  status: 'NEW' | 'FILLED' | 'REJECTED' | 'CANCELLED';
  type: 'MARKET' | 'LIMIT';
}

let pool: Pool;
let moduleRef: TestingModule | undefined;
let repository: AccountMovementRepository;
let service: GetAccountResourcesUseCase;
let seedOrderCount = 0;

const fixtures: FixtureOrder[] = [
  {
    instrumentId: CASH_INSTRUMENT_ID,
    userId: FIRST_USER_ID,
    size: 1_000,
    price: '1',
    side: 'CASH_IN',
    status: 'FILLED',
    type: 'MARKET',
  },
  {
    instrumentId: FIRST_INSTRUMENT_ID,
    userId: FIRST_USER_ID,
    size: 3,
    price: '100',
    side: 'BUY',
    status: 'FILLED',
    type: 'MARKET',
  },
  {
    instrumentId: FIRST_INSTRUMENT_ID,
    userId: FIRST_USER_ID,
    size: 1,
    price: '120',
    side: 'SELL',
    status: 'FILLED',
    type: 'LIMIT',
  },
  {
    instrumentId: FIRST_INSTRUMENT_ID,
    userId: FIRST_USER_ID,
    size: 2,
    price: '50',
    side: 'BUY',
    status: 'NEW',
    type: 'LIMIT',
  },
  {
    instrumentId: FIRST_INSTRUMENT_ID,
    userId: FIRST_USER_ID,
    size: 1,
    price: null,
    side: 'SELL',
    status: 'NEW',
    type: 'LIMIT',
  },
  {
    instrumentId: FIRST_INSTRUMENT_ID,
    userId: FIRST_USER_ID,
    size: 100,
    price: '10',
    side: 'BUY',
    status: 'CANCELLED',
    type: 'LIMIT',
  },
  {
    instrumentId: FIRST_INSTRUMENT_ID,
    userId: FIRST_USER_ID,
    size: 5,
    price: '10',
    side: 'SELL',
    status: 'REJECTED',
    type: 'MARKET',
  },
  {
    instrumentId: CASH_INSTRUMENT_ID,
    userId: SECOND_USER_ID,
    size: 5_000,
    price: '1',
    side: 'CASH_IN',
    status: 'FILLED',
    type: 'MARKET',
  },
  {
    instrumentId: FIRST_INSTRUMENT_ID + 1,
    userId: SECOND_USER_ID,
    size: 7,
    price: '10',
    side: 'BUY',
    status: 'FILLED',
    type: 'MARKET',
  },
  {
    instrumentId: FIRST_INSTRUMENT_ID + 1,
    userId: SECOND_USER_ID,
    size: 2,
    price: null,
    side: 'SELL',
    status: 'NEW',
    type: 'LIMIT',
  },
  {
    instrumentId: FIRST_INSTRUMENT_ID + 1,
    userId: SECOND_USER_ID,
    size: 3,
    price: '0.10',
    side: 'BUY',
    status: 'NEW',
    type: 'LIMIT',
  },
  {
    instrumentId: FIRST_INSTRUMENT_ID + 2,
    userId: SECOND_USER_ID,
    size: 4,
    price: '5',
    side: 'BUY',
    status: 'FILLED',
    type: 'LIMIT',
  },
  ...Array.from({ length: 5 }, (): FixtureOrder => ({
    instrumentId: FIRST_INSTRUMENT_ID,
    userId: LIMIT_USER_ID,
    size: MAX_SIZE,
    price: MAX_PRICE,
    side: 'BUY',
    status: 'NEW',
    type: 'LIMIT',
  })),
];

beforeAll(async () => {
  pool = createTestPool();
  await resetFixtures(pool);

  const seedCount = await pool.query<{ count: number }>(
    'SELECT count(*)::int AS count FROM orders',
  );
  seedOrderCount = seedCount.rows[0]?.count ?? 0;

  await pool.query(
    `INSERT INTO users (id, email, accountnumber)
     VALUES ($1, $2, $3), ($4, $5, $6), ($7, $8, $9)`,
    [
      FIRST_USER_ID,
      'b02-first@example.invalid',
      'B02001',
      SECOND_USER_ID,
      'b02-second@example.invalid',
      'B02002',
      LIMIT_USER_ID,
      'b02-limit@example.invalid',
      'B02003',
    ],
  );
  await pool.query(
    `INSERT INTO instruments (id, ticker, name, type)
     VALUES ($1, $2, $3, 'ACCIONES'),
            ($4, $5, $6, 'ACCIONES'),
            ($7, $8, $9, 'ACCIONES'),
            ($10, $11, $12, 'MONEDA')`,
    [
      FIRST_INSTRUMENT_ID,
      'B02A',
      'B02 account fixture A',
      FIRST_INSTRUMENT_ID + 1,
      'B02B',
      'B02 account fixture B',
      FIRST_INSTRUMENT_ID + 2,
      'B02C',
      'B02 account fixture C',
      CASH_INSTRUMENT_ID,
      'B02CASH',
      'B02 cash fixture',
    ],
  );

  for (const [index, order] of fixtures.entries()) {
    await pool.query(
      `INSERT INTO orders
         (instrumentId, userId, size, price, type, side, status, datetime)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [
        order.instrumentId,
        order.userId,
        order.size,
        order.price,
        order.type,
        order.side,
        order.status,
        `2026-10-27 12:00:${String(index).padStart(2, '0')}`,
      ],
    );
  }

  moduleRef = await Test.createTestingModule({
    imports: [AppModule],
  }).compile();
  await moduleRef.init();
  repository = moduleRef.get<AccountMovementRepository>(
    ACCOUNT_MOVEMENT_REPOSITORY,
  );
  service = moduleRef.get<GetAccountResourcesUseCase>(
    GET_ACCOUNT_RESOURCES_USE_CASE,
  );
});

afterAll(async () => {
  await resetFixtures(pool);
  await moduleRef?.close();
  await pool.end();
});

describe('Postgres account resources against PostgreSQL', () => {
  it('reads only the movements of the selected account', async () => {
    const firstAccount = await repository.findByUserId(FIRST_USER_ID);
    const secondAccount = await repository.findByUserId(SECOND_USER_ID);
    const firstOrderIds = await pool.query<{ id: number }>(
      'SELECT id FROM orders WHERE userid = $1 ORDER BY id',
      [FIRST_USER_ID],
    );
    const secondOrderIds = await pool.query<{ id: number }>(
      'SELECT id FROM orders WHERE userid = $1 ORDER BY id',
      [SECOND_USER_ID],
    );

    expect(
      firstAccount.map((movement) => movement.id).sort((a, b) => a - b),
    ).toEqual(firstOrderIds.rows.map((row) => row.id));
    expect(
      secondAccount.map((movement) => movement.id).sort((a, b) => a - b),
    ).toEqual(secondOrderIds.rows.map((row) => row.id));
  });

  it('calculates cash, holdings, reservations and availability for a fixture account', async () => {
    const resources = await service.execute({ userId: FIRST_USER_ID });

    expect(resources.accountingCash.toFixed(2)).toBe('820.00');
    expect(resources.reservedBuyCash.toFixed(2)).toBe('100.00');
    expect(resources.availableCash.toFixed(2)).toBe('720.00');
    expect(resources.instruments).toEqual([
      {
        instrumentId: FIRST_INSTRUMENT_ID,
        executedQuantity: 2,
        sellReservedQuantity: 1,
        availableQuantity: 1,
      },
    ]);
  });

  it('isolates accounts and instruments while keeping decimal reservations exact', async () => {
    const resources = await service.execute({ userId: SECOND_USER_ID });

    expect(resources.accountingCash.toFixed(2)).toBe('4910.00');
    expect(resources.reservedBuyCash.toFixed(2)).toBe('0.30');
    expect(resources.availableCash.toFixed(2)).toBe('4909.70');
    expect(resources.instruments).toEqual([
      {
        instrumentId: FIRST_INSTRUMENT_ID + 1,
        executedQuantity: 7,
        sellReservedQuantity: 2,
        availableQuantity: 5,
      },
      {
        instrumentId: FIRST_INSTRUMENT_ID + 2,
        executedQuantity: 4,
        sellReservedQuantity: 0,
        availableQuantity: 4,
      },
    ]);
  });

  it('reads and calculates the INT and NUMERIC(10,2) limit case exactly', async () => {
    const movements = await repository.findByUserId(LIMIT_USER_ID);
    const resources = await service.execute({ userId: LIMIT_USER_ID });

    expect(movements).toHaveLength(5);
    expect(
      movements.every(
        (movement) =>
          movement.size === MAX_SIZE &&
          movement.price === MAX_PRICE &&
          movement.side === 'BUY' &&
          movement.status === 'NEW',
      ),
    ).toBe(true);
    expect(resources.accountingCash.toFixed(2)).toBe('0.00');
    expect(resources.reservedBuyCash.toFixed(2)).toBe(
      '1073741823392625817.65',
    );
    expect(resources.availableCash.toFixed(2)).toBe(
      '-1073741823392625817.65',
    );
    expect(resources.instruments).toEqual([]);
  });

  it('reads the seed without modifying it and preserves the negative executed quantity', async () => {
    const resources = await service.execute({ userId: 1 });
    const orderCount = await pool.query<{ count: number }>(
      'SELECT count(*)::int AS count FROM orders WHERE userid NOT IN ($1, $2, $3)',
      [FIRST_USER_ID, SECOND_USER_ID, LIMIT_USER_ID],
    );

    expect(resources.accountingCash.toFixed(2)).toBe('753000.00');
    expect(resources.reservedBuyCash.toFixed(2)).toBe('125500.00');
    expect(resources.availableCash.toFixed(2)).toBe('627500.00');
    expect(resources.instruments).toEqual([
      {
        instrumentId: 31,
        executedQuantity: -10,
        sellReservedQuantity: 0,
        availableQuantity: -10,
      },
      {
        instrumentId: 47,
        executedQuantity: 40,
        sellReservedQuantity: 0,
        availableQuantity: 40,
      },
      {
        instrumentId: 54,
        executedQuantity: 500,
        sellReservedQuantity: 0,
        availableQuantity: 500,
      },
    ]);
    expect(orderCount.rows[0]?.count).toBe(seedOrderCount);
  });
});

async function resetFixtures(target: Pool): Promise<void> {
  await target.query('DELETE FROM orders WHERE userid IN ($1, $2, $3)', [
    FIRST_USER_ID,
    SECOND_USER_ID,
    LIMIT_USER_ID,
  ]);
  await target.query('DELETE FROM instruments WHERE id BETWEEN $1 AND $2', [
    FIRST_INSTRUMENT_ID,
    LAST_INSTRUMENT_ID,
  ]);
  await target.query('DELETE FROM users WHERE id IN ($1, $2, $3)', [
    FIRST_USER_ID,
    SECOND_USER_ID,
    LIMIT_USER_ID,
  ]);
}
