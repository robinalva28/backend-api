import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Client } from 'pg';
import { describe, expect, it } from 'vitest';
import {
  postgresConnectionMode,
  readPostgresConfig,
} from '../../src/database/postgres.config.js';

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

  it('gives DATABASE_URL priority over every PG variable', () => {
    const config = readPostgresConfig({
      DATABASE_URL:
        'postgresql://remote-user:remote-password@remote.example.com:6543/remote-db?sslmode=verify-full',
      PGHOST: 'local-host',
      PGPORT: '5433',
      PGDATABASE: 'local-database',
      PGUSER: 'local-user',
      PGPASSWORD: 'local-password',
    });

    expect(new Client(config)).toMatchObject({
      host: 'remote.example.com',
      port: 6543,
      database: 'remote-db',
      user: 'remote-user',
      password: 'remote-password',
      ssl: { rejectUnauthorized: true },
    });
    expect(config).not.toHaveProperty('host');
    expect(config).not.toHaveProperty('password');
  });

  it.each([
    '',
    '   ',
    'not-a-url',
    'mysql://user:password@host/database',
    'postgresql:///database-without-host',
    'postgresql://user:password@host/database?sslmode=disable',
    'postgresql://user:password@host/database?sslmode=prefer',
    'postgresql://user:password@host/database?sslmode=no-verify',
    'postgresql://user:password@host/database?ssl=0',
    'postgresql://user:password@host/database?uselibpqcompat=true&sslmode=require',
  ])('rejects the invalid or unsafe remote URL %j', (DATABASE_URL) => {
    expect(() =>
      readPostgresConfig({
        DATABASE_URL,
        PGHOST: 'valid-local-host',
        PGPASSWORD: 'valid-local-password',
      }),
    ).toThrow(/DATABASE_URL/);
  });

  it.each(['require', 'verify-ca', 'verify-full'])(
    'preserves the explicit CA in the effective client with sslmode=%s',
    (sslmode) => {
      const directory = mkdtempSync(join(tmpdir(), 'backend-api-ca-'));
      const caPath = join(directory, 'ca.pem');

      try {
        writeFileSync(caPath, 'test-ca-certificate', 'utf8');
        const config = readPostgresConfig({
          DATABASE_URL: `postgresql://user:password@host/database?sslmode=${sslmode}`,
          PGSSLROOTCERT: caPath,
        });

        expect(new Client(config).ssl).toEqual({
          rejectUnauthorized: true,
          ca: 'test-ca-certificate',
        });
      } finally {
        rmSync(directory, { recursive: true, force: true });
      }
    },
  );

  it.each([
    '', 'ssl=1', 'ssl=true', 'sslmode=require', 'sslmode=verify-ca',
    'sslmode=verify-full', 'sslmode=VERIFY-FULL',
    'uselibpqcompat=false&sslmode=require', 'sslnegotiation=direct',
    'sslnegotiation=postgres&sslmode=verify-full',
  ])('keeps effective certificate and default hostname verification with %s', (query) => {
    const config = readPostgresConfig({
      DATABASE_URL: `postgresql://user:password@host/database?${query}`,
    });
    const client = new Client(config);

    // Equality also rules out a checkServerIdentity override that skips hostname checks.
    expect(client.ssl).toEqual({ rejectUnauthorized: true });
    expect(client.host).toBe('host');
    expect(new URL(config.connectionString!).search).toBe('');
    if (query === 'sslnegotiation=direct') {
      expect(client).toHaveProperty('connectionParameters.sslnegotiation', 'direct');
    }
  });

  it.each([
    'ssl=false', 'ssl=no-verify', 'ssl=unknown', 'ssl=',
    'sslmode=allow', 'sslmode=unknown', 'sslmode=',
    'ssl=0&sslmode=verify-full', 'sslmode=disable&ssl=true',
    'uselibpqcompat=true&sslmode=verify-ca', 'uselibpqcompat=unknown',
    'sslnegotiation=unknown',
    'sslmode=verify-full&sslmode=disable', 'sslmode=disable&sslmode=verify-full',
    'sslmode=verify-full&sslmode=verify-full', 'ssl=true&ssl=0',
    'sslrootcert=first&sslrootcert=second', 'sslcert=first&sslcert=second',
    'sslkey=first&sslkey=second', 'uselibpqcompat=false&uselibpqcompat=true',
    'sslnegotiation=postgres&sslnegotiation=direct',
    'channel_binding=prefer&channel_binding=require',
    'channel_binding=disable&channel_binding=prefer',
    'channel_binding=prefer&channel_binding=prefer',
  ])('rejects unsafe, unknown or repeated options before constructing a client: %s', (query) => {
    expect(() => new Client(readPostgresConfig({
      DATABASE_URL: `postgresql://user:password@host/database?${query}`,
      PGHOST: 'local-host',
    }))).toThrow(/DATABASE_URL/);
  });

  it.each([
    ['postgresql://us%40er:p%3Aa%2Fs%3Fs%23%25@db.example.com:6543/db%20name',
      { host: 'db.example.com', user: 'us@er', password: 'p:a/s?s#%', port: 6543, database: 'db name' }],
    ['postgresql://user:password@[::1]:6543/database',
      { host: '::1', user: 'user', password: 'password', port: 6543, database: 'database' }],
    ['postgresql://user:password@host:5432/database?host=other.example.com&port=6543&user=other&password=p%26ss&application_name=test%20app',
      { host: 'other.example.com', user: 'other', password: 'p&ss', port: 6543, database: 'database' }],
  ])('preserves pg connection identity for %s', (url, identity) => {
    const separator = url.includes('?') ? '&' : '?';
    const client = new Client(readPostgresConfig({
      DATABASE_URL: `${url}${separator}sslmode=verify-full&channel_binding=prefer`,
    }));

    expect(client).toMatchObject(identity);
    expect(client.ssl).toEqual({ rejectUnauthorized: true });
    expect(client).toHaveProperty('enableChannelBinding', true);
    if (url.includes('application_name=')) {
      expect(client).toHaveProperty('connectionParameters.application_name', 'test app');
    }
  });

  it('preserves URL CA and client certificates without letting pg reconstruct ssl', () => {
    const directory = mkdtempSync(join(tmpdir(), 'backend-api-tls-'));
    try {
      const query = new URLSearchParams({ sslmode: 'verify-full', sslnegotiation: 'direct' });
      for (const parameter of ['sslrootcert', 'sslcert', 'sslkey']) {
        const path = join(directory, `${parameter}.pem`);
        writeFileSync(path, `test-${parameter}`, 'utf8');
        query.set(parameter, path);
      }
      const client = new Client(readPostgresConfig({
        DATABASE_URL: `postgresql://user:password@host/database?${query}`,
      }));
      expect(client.ssl).toMatchObject({
        rejectUnauthorized: true, ca: 'test-sslrootcert', cert: 'test-sslcert', key: 'test-sslkey',
      });
      expect(client.ssl).not.toHaveProperty('checkServerIdentity');

      const config = readPostgresConfig({
        DATABASE_URL: `postgresql://user:password@host/database?${query}`,
        PGSSLROOTCERT: join(directory, 'sslcert.pem'),
      });
      expect(new Client(config).ssl).toHaveProperty('ca', 'test-sslcert');
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it.each([['', false], ['disable', false], ['prefer', true]] as const)(
    'translates channel_binding=%s into the effective pg client option', (mode, enabled) => {
      const client = new Client(readPostgresConfig({
        DATABASE_URL: `postgresql://user:password@host/database${mode ? `?channel_binding=${mode}` : ''}`,
      }));
      expect(client).toHaveProperty('enableChannelBinding', enabled);
      expect(client.ssl).toEqual({ rejectUnauthorized: true });
    },
  );

  it('rejects required channel binding with an explicit limitation and alternative', () => {
    expect(() => new Client(readPostgresConfig({
      DATABASE_URL: 'postgresql://user:password@host/database?channel_binding=require',
    }))).toThrow(/channel_binding=require cannot be guaranteed by pg; prefer enables optional negotiation only/);
  });

  it.each(['', 'unknown', 'true', 'PREFER'])(
    'rejects unsupported channel_binding=%s', (mode) => {
      expect(() => new Client(readPostgresConfig({
        DATABASE_URL: `postgresql://user:password@host/database?channel_binding=${mode}`,
      }))).toThrow(/channel_binding must be disable or prefer/);
    },
  );

  it('rejects an unreadable private CA without exposing its path', () => {
    expect(() =>
      readPostgresConfig({
        DATABASE_URL: 'postgresql://user:password@host/database',
        PGSSLROOTCERT: '/missing/private-ca.pem',
      }),
    ).toThrow(/PGSSLROOTCERT could not be read/);
  });

  it('does not fall back to the local PG variables when the remote URL fails', () => {
    expect(() =>
      readPostgresConfig({
        DATABASE_URL: '',
        PGHOST: 'db.internal',
        PGDATABASE: 'backend_api_test',
        PGUSER: 'tester',
        PGPASSWORD: 'local-password',
      }),
    ).toThrow(/DATABASE_URL must not be empty/);
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

describe('postgresConnectionMode', () => {
  it('reports local mode only when DATABASE_URL is absent', () => {
    expect(postgresConnectionMode({})).toBe('local');
    expect(
      postgresConnectionMode({
        DATABASE_URL: 'postgresql://user:password@host/database',
      }),
    ).toBe('remote');
    expect(postgresConnectionMode({ DATABASE_URL: '' })).toBe('remote');
  });
});
