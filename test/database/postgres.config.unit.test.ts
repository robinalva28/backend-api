import { describe, expect, it } from 'vitest';
import { readPostgresConfig } from '../../src/database/postgres.config.js';

describe('readPostgresConfig', () => {
  it('builds an explicit pool configuration from the environment', () => {
    expect(
      readPostgresConfig({
        PGHOST: 'db.internal',
        PGPORT: '5433',
        PGDATABASE: 'backend_api_test',
        PGUSER: 'tester',
        PGPASSWORD: 'local-password',
      }),
    ).toEqual({
      host: 'db.internal',
      port: 5433,
      database: 'backend_api_test',
      user: 'tester',
      password: 'local-password',
    });
  });

  it('uses the local defaults when the variables are absent', () => {
    expect(readPostgresConfig({})).toEqual({
      host: '127.0.0.1',
      port: 5432,
      database: 'backend_api',
      user: 'backend_api',
      password: 'backend-api-local',
    });
  });

  it.each(['0', '65536', '1.5', 'not-a-port', ''])(
    'rejects the invalid port %j',
    (port) => {
      expect(() =>
        readPostgresConfig({
          PGPORT: port,
        }),
      ).toThrow(/PGPORT/);
    },
  );

  it.each(['PGHOST', 'PGDATABASE', 'PGUSER', 'PGPASSWORD'] as const)(
    'rejects an empty %s',
    (variable) => {
      expect(() =>
        readPostgresConfig({
          [variable]: '   ',
        }),
      ).toThrow(new RegExp(variable));
    },
  );
});
