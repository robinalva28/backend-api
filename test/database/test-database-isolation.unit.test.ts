import { afterEach, describe, expect, it } from 'vitest';
import {
  applyTestDatabaseEnvironment,
  testDatabaseConfig,
} from '../support/test-database.js';

const ENVIRONMENT_KEYS = [
  'DATABASE_URL',
  'PGSSLROOTCERT',
  'PGSSLMODE',
  'PGHOST',
  'PGPORT',
  'PGDATABASE',
  'PGUSER',
  'PGPASSWORD',
] as const;

const originalEnvironment = new Map(
  ENVIRONMENT_KEYS.map((key) => [key, process.env[key]]),
);

afterEach(() => {
  for (const key of ENVIRONMENT_KEYS) {
    const original = originalEnvironment.get(key);

    if (original === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = original;
    }
  }
});

describe('test database isolation', () => {
  it('removes remote connection settings and selects backend_api_test', () => {
    process.env['DATABASE_URL'] =
      'postgresql://remote-user:remote-password@remote.example.com/remote-db';
    process.env['PGSSLROOTCERT'] = '/tmp/remote-ca.pem';
    process.env['PGSSLMODE'] = 'verify-full';
    process.env['PGDATABASE'] = 'remote_database';

    const config = applyTestDatabaseEnvironment();

    expect(process.env['DATABASE_URL']).toBeUndefined();
    expect(process.env['PGSSLROOTCERT']).toBeUndefined();
    expect(process.env['PGSSLMODE']).toBeUndefined();
    expect(config.database).toBe('backend_api_test');
    expect(process.env['PGDATABASE']).toBe('backend_api_test');
  });

  it('rejects any database name other than backend_api_test', () => {
    process.env['TEST_PGDATABASE'] = 'backend_api';

    try {
      expect(() => testDatabaseConfig()).toThrow(/backend_api_test/);
    } finally {
      delete process.env['TEST_PGDATABASE'];
    }
  });
});
