import { Pool } from 'pg';

const TEST_DATABASE = 'backend_api_test';

export interface TestDatabaseConfig {
  host: string;
  port: number;
  database: string;
  user: string;
  password: string;
}

export function testDatabaseConfig(): TestDatabaseConfig {
  const host = process.env['TEST_PGHOST'] ?? '127.0.0.1';
  const port = Number(process.env['PGTESTPORT'] ?? '5433');
  const database = process.env['TEST_PGDATABASE'] ?? TEST_DATABASE;
  const user = process.env['TEST_PGUSER'] ?? process.env['PGUSER'] ?? 'backend_api';
  const password =
    process.env['TEST_PGPASSWORD'] ??
    process.env['PGPASSWORD'] ??
    'backend-api-local';

  if (database !== TEST_DATABASE) {
    throw new Error(
      `Refusing to run tests against database "${database}"; expected "${TEST_DATABASE}".`,
    );
  }

  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error('The test PostgreSQL port must be an integer between 1 and 65535.');
  }

  return { host, port, database, user, password };
}

export function applyTestDatabaseEnvironment(): TestDatabaseConfig {
  const config = testDatabaseConfig();

  process.env['PGHOST'] = config.host;
  process.env['PGPORT'] = String(config.port);
  process.env['PGDATABASE'] = config.database;
  process.env['PGUSER'] = config.user;
  process.env['PGPASSWORD'] = config.password;

  return config;
}

export function createTestPool(): Pool {
  return new Pool({ ...testDatabaseConfig(), max: 4 });
}
