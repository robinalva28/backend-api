import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import type { Pool, PoolClient } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestPool } from '../support/test-database.js';

const MIGRATION_PATH = resolve(
  process.cwd(),
  'db/migrations/20261028-b04b-order-idempotency.sql',
);

const USER_A = 4201;
const USER_B = 4202;
const INSTRUMENT_ID = 4201;
const SHARED_UUID = '11111111-1111-4111-8111-111111111111';
const METADATA_WITH_DECIMALS = JSON.stringify({
  version: 1,
  parameters: {
    price: '10.10',
    amount: '100.00',
  },
});

const CONSTRAINT_NAMES = [
  'orders_idempotency_metadata_check',
  'orders_idempotency_pair_check',
  'orders_user_idempotency_key_unique',
] as const;

const COLUMNS_SQL = `
  SELECT column_name, data_type, is_nullable, column_default
    FROM information_schema.columns
   WHERE table_schema = (
           SELECT n.nspname
             FROM pg_class c
             JOIN pg_namespace n ON n.oid = c.relnamespace
            WHERE c.oid = 'orders'::regclass
         )
     AND table_name = 'orders'
     AND column_name IN ('idempotency_key', 'idempotency_metadata')
   ORDER BY column_name
`;

const CONSTRAINTS_SQL = `
  SELECT conname, contype::text AS contype, pg_get_constraintdef(oid) AS definition
    FROM pg_constraint
   WHERE conrelid = 'orders'::regclass
     AND conname = ANY($1::text[])
   ORDER BY conname
`;

const CONSTRAINT_COLUMNS_SQL = `
  SELECT a.attname AS column_name
    FROM pg_constraint c
    CROSS JOIN LATERAL unnest(c.conkey) WITH ORDINALITY AS keys(attnum, position)
    JOIN pg_attribute a
      ON a.attrelid = c.conrelid
     AND a.attnum = keys.attnum
   WHERE c.conrelid = 'orders'::regclass
     AND c.conname = $1
   ORDER BY keys.position
`;

const ORIGINAL_ORDERS_SQL = `
  SELECT id,
         instrumentid,
         userid,
         size,
         price::text AS price,
         type,
         side,
         status,
         datetime::text AS datetime
    FROM orders
   ORDER BY id
`;

interface ColumnRow {
  column_name: string;
  data_type: string;
  is_nullable: string;
  column_default: string | null;
}

interface ConstraintRow {
  conname: string;
  contype: string;
  definition: string;
}

interface OriginalOrderRow {
  id: number;
  instrumentid: number | null;
  userid: number | null;
  size: number | null;
  price: string | null;
  type: string | null;
  side: string | null;
  status: string | null;
  datetime: string | null;
}

interface InsertOrderOptions {
  readonly userId?: number | null;
  readonly key?: string | null;
  readonly metadata?: string | null;
  readonly size?: number;
  readonly price?: string;
}

interface InvalidMetadataCase {
  readonly label: string;
  readonly value: unknown;
}

const invalidMetadataCases: readonly InvalidMetadataCase[] = [
  { label: 'missing version', value: { parameters: {} } },
  { label: 'string version', value: { version: '1', parameters: {} } },
  { label: 'fractional version', value: { version: 1.5, parameters: {} } },
  { label: 'zero version', value: { version: 0, parameters: {} } },
  { label: 'missing parameters', value: { version: 1 } },
  { label: 'array parameters', value: { version: 1, parameters: [] } },
  { label: 'string parameters', value: { version: 1, parameters: 'open' } },
  { label: 'null parameters', value: { version: 1, parameters: null } },
  { label: 'array envelope', value: [] },
  { label: 'string envelope', value: 'not-an-object' },
  { label: 'null envelope', value: null },
];

let pool: Pool;
let migrationSql: string;

beforeAll(async () => {
  pool = createTestPool();
  migrationSql = await readFile(MIGRATION_PATH, 'utf8');

  const existingColumns = await pool.query<ColumnRow>(COLUMNS_SQL);

  if (existingColumns.rows.length > 0) {
    throw new Error(
      'B04-B migration tests require the original orders schema; reset db-test.',
    );
  }
});

afterAll(async () => {
  try {
    const remainingColumns = await pool.query<ColumnRow>(COLUMNS_SQL);
    expect(remainingColumns.rows).toHaveLength(0);
  } finally {
    await pool.end();
  }
});

describe('B04-B order idempotency migration against PostgreSQL', () => {
  it('applies to the original schema and preserves every historical order value', async () => {
    await withTransaction(async (client) => {
      const before = await readOriginalOrders(client);
      expect(before.length).toBeGreaterThan(0);

      await applyMigration(client);

      const after = await readOriginalOrders(client);
      const identityCount = await readIdentityCount(client);

      expect(after).toEqual(before);
      expect(identityCount).toBe(0);
    });
  });

  it('creates nullable UUID/JSONB columns and effective constraints', async () => {
    await withMigratedTransaction(async (client) => {
      const columns = await readColumns(client);
      const constraints = await readConstraints(client);
      const uniqueColumns = await readConstraintColumns(
        client,
        'orders_user_idempotency_key_unique',
      );

      expect(columns).toEqual([
        {
          column_name: 'idempotency_key',
          data_type: 'uuid',
          is_nullable: 'YES',
          column_default: null,
        },
        {
          column_name: 'idempotency_metadata',
          data_type: 'jsonb',
          is_nullable: 'YES',
          column_default: null,
        },
      ]);
      expect(constraints.map(({ conname }) => conname)).toEqual([
        ...CONSTRAINT_NAMES,
      ]);

      const byName = new Map(
        constraints.map((constraint) => [constraint.conname, constraint]),
      );
      expect(byName.get('orders_idempotency_pair_check')?.contype).toBe('c');
      expect(
        byName.get('orders_idempotency_pair_check')?.definition,
      ).toContain('idempotency_key');
      expect(
        byName.get('orders_idempotency_pair_check')?.definition,
      ).toContain('idempotency_metadata');
      expect(
        byName.get('orders_idempotency_pair_check')?.definition,
      ).toContain('userid');
      expect(
        byName.get('orders_idempotency_metadata_check')?.contype,
      ).toBe('c');
      expect(
        byName.get('orders_idempotency_metadata_check')?.definition,
      ).toContain('jsonb_typeof');
      expect(
        byName.get('orders_idempotency_metadata_check')?.definition,
      ).toContain('version');
      expect(
        byName.get('orders_idempotency_metadata_check')?.definition,
      ).toContain('parameters');
      expect(byName.get('orders_user_idempotency_key_unique')?.contype).toBe(
        'u',
      );
      expect(uniqueColumns).toEqual(['userid', 'idempotency_key']);
    });
  });

  it('accepts a versioned envelope and preserves decimal strings exactly', async () => {
    await withMigratedAccount(async (client) => {
      const orderId = await insertOrder(client, {
        key: randomUUID(),
        metadata: METADATA_WITH_DECIMALS,
      });
      const stored = await client.query<{
        price: string | null;
        amount: string | null;
      }>(
        `SELECT idempotency_metadata->'parameters'->>'price' AS price,
                idempotency_metadata->'parameters'->>'amount' AS amount
           FROM orders
          WHERE id = $1`,
        [orderId],
      );

      expect(stored.rows[0]).toEqual({ price: '10.10', amount: '100.00' });
    });
  });

  it.each(invalidMetadataCases)(
    'rejects invalid metadata: $label',
    async ({ value }) => {
      await withMigratedAccount(async (client) => {
        await expectSqlState(client, '23514', () =>
          insertOrder(client, {
            key: randomUUID(),
            metadata: JSON.stringify(value),
          }),
        );
      });
    },
  );

  it('rejects a key without metadata and metadata without a key', async () => {
    await withMigratedAccount(async (client) => {
      await expectSqlState(client, '23514', () =>
        insertOrder(client, { key: randomUUID() }),
      );
      await expectSqlState(client, '23514', () =>
        insertOrder(client, { metadata: METADATA_WITH_DECIMALS }),
      );
    });
  });

  it('keeps SQL NULL distinct from JSON null', async () => {
    await withMigratedAccount(async (client) => {
      const historicalStyleId = await insertOrder(client, {
        key: null,
        metadata: null,
      });
      expect(historicalStyleId).toBeGreaterThan(0);

      await expectSqlState(client, '23514', () =>
        insertOrder(client, {
          key: randomUUID(),
          metadata: 'null',
        }),
      );
    });
  });

  it('rejects an invalid UUID and a keyed order without an account', async () => {
    await withMigratedAccount(async (client) => {
      await expectSqlState(client, '22P02', () =>
        insertOrder(client, {
          key: 'not-a-uuid',
          metadata: METADATA_WITH_DECIMALS,
        }),
      );
      await expectSqlState(client, '23514', () =>
        insertOrder(client, {
          userId: null,
          key: randomUUID(),
          metadata: METADATA_WITH_DECIMALS,
        }),
      );
    });
  });

  it('rejects a duplicate user/UUID without overwriting and allows another account', async () => {
    await withMigratedAccount(async (client) => {
      const firstId = await insertOrder(client, {
        userId: USER_A,
        key: SHARED_UUID,
        metadata: JSON.stringify({
          version: 1,
          parameters: { marker: 'first' },
        }),
        size: 2,
        price: '10.00',
      });

      await expectSqlState(client, '23505', () =>
        insertOrder(client, {
          userId: USER_A,
          key: SHARED_UUID,
          metadata: JSON.stringify({
            version: 1,
            parameters: { marker: 'second' },
          }),
          size: 9,
          price: '99.00',
        }),
      );

      const first = await client.query<{
        id: number;
        size: number | null;
        price: string | null;
        idempotency_metadata: unknown;
      }>(
        `SELECT id, size, price::text AS price, idempotency_metadata
           FROM orders
          WHERE userid = $1
            AND idempotency_key = $2`,
        [USER_A, SHARED_UUID],
      );

      expect(first.rows).toHaveLength(1);
      expect(first.rows[0]).toMatchObject({
        id: firstId,
        size: 2,
        price: '10.00',
      });
      expect(first.rows[0]?.idempotency_metadata).toEqual({
        version: 1,
        parameters: { marker: 'first' },
      });

      const secondId = await insertOrder(client, {
        userId: USER_B,
        key: SHARED_UUID,
        metadata: METADATA_WITH_DECIMALS,
      });
      expect(secondId).not.toBe(firstId);

      const count = await client.query<{ count: number }>(
        'SELECT count(*)::int AS count FROM orders WHERE idempotency_key = $1',
        [SHARED_UUID],
      );
      expect(count.rows[0]?.count).toBe(2);
    });
  });

  it('treats a second execution as a verified no-op', async () => {
    await withMigratedTransaction(async (client) => {
      const columnsBefore = await readColumns(client);
      const constraintsBefore = await readConstraints(client);
      const identityCountBefore = await readIdentityCount(client);

      await applyMigration(client);

      expect(await readColumns(client)).toEqual(columnsBefore);
      expect(await readConstraints(client)).toEqual(constraintsBefore);
      expect(await readIdentityCount(client)).toBe(identityCountBefore);
    });
  });

  it('fails safely on an incomplete schema missing a constraint', async () => {
    await expect(
      withTransaction(async (client) => {
        await applyMigration(client);
        await client.query(
          'ALTER TABLE orders DROP CONSTRAINT orders_idempotency_pair_check',
        );
        await applyMigration(client);
      }),
    ).rejects.toThrow(/incomplete orders schema/i);

    await withTransaction(async (client) => {
      expect(await readColumns(client)).toEqual([]);
      expect(await readConstraints(client)).toEqual([]);
    });
  });

  it('rejects a unique constraint with an extra key column', async () => {
    await expectIncompatibleSchema(
      async (client) => {
        await client.query(
          'ALTER TABLE orders DROP CONSTRAINT orders_user_idempotency_key_unique',
        );
        await client.query(
          `ALTER TABLE orders
             ADD CONSTRAINT orders_user_idempotency_key_unique
             UNIQUE (userid, idempotency_key, id)`,
        );
        await insertFixtureAccount(client);
        await insertOrder(client, {
          key: SHARED_UUID,
          metadata: METADATA_WITH_DECIMALS,
        });
        await insertOrder(client, {
          key: SHARED_UUID,
          metadata: METADATA_WITH_DECIMALS,
        });
      },
      /incompatible constraint orders_user_idempotency_key_unique/i,
    );
  });

  it('rejects a pair check weakened with OR true', async () => {
    await expectIncompatibleSchema(
      async (client) => {
        await client.query(
          'ALTER TABLE orders DROP CONSTRAINT orders_idempotency_pair_check',
        );
        await client.query(
          `ALTER TABLE orders
             ADD CONSTRAINT orders_idempotency_pair_check
             CHECK (
               ((idempotency_key IS NULL) = (idempotency_metadata IS NULL))
               AND (idempotency_key IS NULL OR userid IS NOT NULL)
               OR true
             )`,
        );
        await insertFixtureAccount(client);
        await insertOrder(client, { key: randomUUID() });
      },
      /incompatible constraint orders_idempotency_pair_check/i,
    );
  });

  it('rejects a metadata check weakened with OR true', async () => {
    await expectIncompatibleSchema(
      async (client) => {
        await client.query(
          'ALTER TABLE orders DROP CONSTRAINT orders_idempotency_metadata_check',
        );
        await client.query(
          `ALTER TABLE orders
             ADD CONSTRAINT orders_idempotency_metadata_check
             CHECK (
               idempotency_metadata IS NULL
               OR COALESCE(
                 jsonb_typeof(idempotency_metadata) = 'object'
                 AND jsonb_typeof(idempotency_metadata->'version') = 'number'
                 AND (idempotency_metadata->>'version') ~ '^[1-9][0-9]*$'
                 AND jsonb_typeof(idempotency_metadata->'parameters') = 'object',
                 false
               )
               OR true
             )`,
        );
        await insertFixtureAccount(client);
        await insertOrder(client, {
          key: randomUUID(),
          metadata: JSON.stringify({ parameters: {} }),
        });
      },
      /incompatible constraint orders_idempotency_metadata_check/i,
    );
  });

  it('rejects an existing constraint that is not validated', async () => {
    await expectIncompatibleSchema(
      async (client) => {
        await client.query(
          'ALTER TABLE orders DROP CONSTRAINT orders_idempotency_pair_check',
        );
        await client.query(
          `ALTER TABLE orders
             ADD CONSTRAINT orders_idempotency_pair_check
             CHECK (
               (idempotency_key IS NULL) = (idempotency_metadata IS NULL)
               AND (idempotency_key IS NULL OR userid IS NOT NULL)
             ) NOT VALID`,
        );
      },
      /incompatible constraint orders_idempotency_pair_check/i,
    );
  });

  it('rejects a metadata check with an altered version literal', async () => {
    await expectIncompatibleSchema(
      async (client) => {
        await client.query(
          'ALTER TABLE orders DROP CONSTRAINT orders_idempotency_metadata_check',
        );
        await client.query(
          `ALTER TABLE orders
             ADD CONSTRAINT orders_idempotency_metadata_check
             CHECK (
               idempotency_metadata IS NULL
               OR COALESCE(
                 jsonb_typeof(idempotency_metadata) = 'object'
                 AND jsonb_typeof(idempotency_metadata->'ver sion') = 'number'
                 AND (idempotency_metadata->>'ver sion') ~ '^[1-9][0-9]*$'
                 AND jsonb_typeof(idempotency_metadata->'parameters') = 'object',
                 false
               )
             )`,
        );
        await insertFixtureAccount(client);
        await insertOrder(client, {
          key: randomUUID(),
          metadata: JSON.stringify({ 'ver sion': 1, parameters: {} }),
        });
      },
      /incompatible constraint orders_idempotency_metadata_check/i,
    );
  });

  it('rejects a metadata check with an altered parameters literal', async () => {
    await expectIncompatibleSchema(
      async (client) => {
        await client.query(
          'ALTER TABLE orders DROP CONSTRAINT orders_idempotency_metadata_check',
        );
        await client.query(
          `ALTER TABLE orders
             ADD CONSTRAINT orders_idempotency_metadata_check
             CHECK (
               idempotency_metadata IS NULL
               OR COALESCE(
                 jsonb_typeof(idempotency_metadata) = 'object'
                 AND jsonb_typeof(idempotency_metadata->'version') = 'number'
                 AND (idempotency_metadata->>'version') ~ '^[1-9][0-9]*$'
                 AND jsonb_typeof(idempotency_metadata->'para meters') = 'object',
                 false
               )
             )`,
        );
        await insertFixtureAccount(client);
        await insertOrder(client, {
          key: randomUUID(),
          metadata: JSON.stringify({ version: 1, 'para meters': {} }),
        });
      },
      /incompatible constraint orders_idempotency_metadata_check/i,
    );
  });

  it('fails safely on an incompatible prior column without partial changes', async () => {
    await expect(
      withTransaction(async (client) => {
        await client.query(
          'ALTER TABLE orders ADD COLUMN idempotency_key UUID',
        );
        await applyMigration(client);
      }),
    ).rejects.toThrow(/incompatible orders schema/i);

    await withTransaction(async (client) => {
      expect(await readColumns(client)).toEqual([]);
      expect(await readConstraints(client)).toEqual([]);
    });
  });

  it('fails safely on an incompatible prior constraint without partial changes', async () => {
    await expect(
      withTransaction(async (client) => {
        await applyMigration(client);
        await client.query(
          'ALTER TABLE orders DROP CONSTRAINT orders_user_idempotency_key_unique',
        );
        await client.query(
          `ALTER TABLE orders
             ADD CONSTRAINT orders_user_idempotency_key_unique CHECK (true)`,
        );
        await applyMigration(client);
      }),
    ).rejects.toThrow(
      /incompatible constraint orders_user_idempotency_key_unique/i,
    );

    await withTransaction(async (client) => {
      expect(await readColumns(client)).toEqual([]);
      expect(await readConstraints(client)).toEqual([]);
    });
  });
});

async function withTransaction<T>(
  work: (client: PoolClient) => Promise<T>,
): Promise<T> {
  const client = await pool.connect();
  let primaryError: unknown;
  let result: T | undefined;

  try {
    await client.query('BEGIN');
    result = await work(client);
  } catch (error) {
    primaryError = error;
  }

  try {
    await client.query('ROLLBACK');
  } catch (rollbackError) {
    if (primaryError === undefined) {
      primaryError = rollbackError;
    }
  } finally {
    client.release();
  }

  if (primaryError !== undefined) {
    throw primaryError;
  }

  return result as T;
}

async function withMigratedTransaction<T>(
  work: (client: PoolClient) => Promise<T>,
): Promise<T> {
  return withTransaction(async (client) => {
    await applyMigration(client);
    return work(client);
  });
}

async function withMigratedAccount<T>(
  work: (client: PoolClient) => Promise<T>,
): Promise<T> {
  return withMigratedTransaction(async (client) => {
    await insertFixtureAccount(client);
    return work(client);
  });
}

async function expectIncompatibleSchema(
  weaken: (client: PoolClient) => Promise<void>,
  expectedError: RegExp,
): Promise<void> {
  await expect(
    withTransaction(async (client) => {
      await applyMigration(client);
      await weaken(client);
      await applyMigration(client);
    }),
  ).rejects.toThrow(expectedError);

  await withTransaction(async (client) => {
    expect(await readColumns(client)).toEqual([]);
    expect(await readConstraints(client)).toEqual([]);
  });
}

async function applyMigration(client: PoolClient): Promise<void> {
  await client.query(migrationSql);
}

async function readColumns(client: PoolClient): Promise<readonly ColumnRow[]> {
  const result = await client.query<ColumnRow>(COLUMNS_SQL);
  return result.rows;
}

async function readConstraints(
  client: PoolClient,
): Promise<readonly ConstraintRow[]> {
  const result = await client.query<ConstraintRow>(CONSTRAINTS_SQL, [
    [...CONSTRAINT_NAMES],
  ]);
  return result.rows;
}

async function readConstraintColumns(
  client: PoolClient,
  constraintName: string,
): Promise<readonly string[]> {
  const result = await client.query<{ column_name: string }>(
    CONSTRAINT_COLUMNS_SQL,
    [constraintName],
  );
  return result.rows.map(({ column_name }) => column_name);
}

async function readOriginalOrders(
  client: PoolClient,
): Promise<readonly OriginalOrderRow[]> {
  const result = await client.query<OriginalOrderRow>(ORIGINAL_ORDERS_SQL);
  return result.rows;
}

async function readIdentityCount(client: PoolClient): Promise<number> {
  const result = await client.query<{ count: number }>(
    `SELECT count(*)::int AS count
       FROM orders
      WHERE idempotency_key IS NOT NULL
         OR idempotency_metadata IS NOT NULL`,
  );
  return result.rows[0]?.count ?? 0;
}

async function insertFixtureAccount(client: PoolClient): Promise<void> {
  await client.query(
    `INSERT INTO users (id, accountnumber)
     VALUES ($1, 'B04B01'), ($2, 'B04B02')`,
    [USER_A, USER_B],
  );
  await client.query(
    `INSERT INTO instruments (id, ticker, name, type)
     VALUES ($1, 'B04B', 'B04B migration fixture', 'ACCIONES')`,
    [INSTRUMENT_ID],
  );
}

async function insertOrder(
  client: PoolClient,
  options: InsertOrderOptions = {},
): Promise<number> {
  const result = await client.query<{ id: number }>(
    `INSERT INTO orders
       (instrumentId, userId, size, price, type, side, status, datetime,
        idempotency_key, idempotency_metadata)
     VALUES ($1, $2, $3, $4, 'MARKET', 'BUY', 'FILLED', $5, $6, $7::jsonb)
     RETURNING id`,
    [
      INSTRUMENT_ID,
      options.userId === undefined ? USER_A : options.userId,
      options.size ?? 1,
      options.price ?? '10.00',
      '2026-10-28 12:00:00',
      options.key ?? null,
      options.metadata ?? null,
    ],
  );
  const orderId = result.rows[0]?.id;

  if (orderId === undefined) {
    throw new Error('Order insertion did not return an id.');
  }

  return orderId;
}

async function expectSqlState(
  client: PoolClient,
  expectedCode: string,
  action: () => Promise<unknown>,
): Promise<void> {
  await client.query('SAVEPOINT expected_failure');
  let caught: unknown;

  try {
    await action();
  } catch (error) {
    caught = error;
  }

  if (caught === undefined) {
    await client.query('ROLLBACK TO SAVEPOINT expected_failure');
    throw new Error(`Expected SQLSTATE ${expectedCode}.`);
  }

  try {
    expect(caught).toMatchObject({ code: expectedCode });
  } finally {
    await client.query('ROLLBACK TO SAVEPOINT expected_failure');
  }
}
