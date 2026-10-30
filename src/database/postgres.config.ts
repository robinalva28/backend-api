import { readFileSync } from 'node:fs';
import type { ConnectionOptions } from 'node:tls';
import type { PoolConfig } from 'pg';

export interface PostgresEnvironment {
  NODE_ENV?: string | undefined;
  DATABASE_URL?: string | undefined;
  PGSSLROOTCERT?: string | undefined;
  PGHOST?: string | undefined;
  PGPORT?: string | undefined;
  PGDATABASE?: string | undefined;
  PGUSER?: string | undefined;
  PGPASSWORD?: string | undefined;
}

export type PostgresConnectionMode = 'local' | 'remote';

const DEFAULT_POSTGRES = {
  host: '127.0.0.1',
  port: 5432,
  database: 'backend_api_test',
  user: 'backend_api',
  password: 'backend-api-local',
} as const;

const REMOTE_SSL_MODES = new Set(['require', 'verify-ca', 'verify-full']);

export function postgresConnectionMode(
  environment: PostgresEnvironment,
): PostgresConnectionMode {
  if (environment.DATABASE_URL !== undefined) {
    return 'remote';
  }

  if (environment.NODE_ENV !== 'test') {
    throw new Error('DATABASE_URL is required outside NODE_ENV=test.');
  }

  return 'local';
}

export function readPostgresConfig(environment: PostgresEnvironment): PoolConfig {
  if (postgresConnectionMode(environment) === 'remote') {
    return readRemotePostgresConfig(environment);
  }

  const port = Number(environment.PGPORT ?? DEFAULT_POSTGRES.port);

  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error('PGPORT must be an integer between 1 and 65535.');
  }

  return {
    host: readValue(environment.PGHOST, DEFAULT_POSTGRES.host, 'PGHOST'),
    port,
    database: readValue(
      environment.PGDATABASE,
      DEFAULT_POSTGRES.database,
      'PGDATABASE',
    ),
    user: readValue(environment.PGUSER, DEFAULT_POSTGRES.user, 'PGUSER'),
    password: readValue(
      environment.PGPASSWORD,
      DEFAULT_POSTGRES.password,
      'PGPASSWORD',
    ),
  };
}

function readRemotePostgresConfig(
  environment: PostgresEnvironment,
): PoolConfig {
  const connectionString = environment.DATABASE_URL?.trim() ?? '';

  if (connectionString === '') {
    throw new Error('DATABASE_URL must not be empty.');
  }

  let parsed: URL;

  try {
    parsed = new URL(connectionString);
  } catch {
    throw new Error('DATABASE_URL must be a valid PostgreSQL connection URL.');
  }

  if (parsed.protocol !== 'postgres:' && parsed.protocol !== 'postgresql:') {
    throw new Error(
      'DATABASE_URL must use the postgres or postgresql protocol.',
    );
  }

  if (parsed.hostname === '') {
    throw new Error('DATABASE_URL must include a database host.');
  }

  // Reject ambiguous input before reading individual values (pg uses the last
  // query value, whereas URLSearchParams.get uses the first).
  for (const key of parsed.searchParams.keys()) {
    if (parsed.searchParams.getAll(key).length > 1) {
      throw new Error('DATABASE_URL must not contain repeated query parameters.');
    }
  }

  const sslMode = parsed.searchParams.get('sslmode')?.toLowerCase();

  if (sslMode !== null && sslMode !== undefined) {
    if (!REMOTE_SSL_MODES.has(sslMode)) {
      throw new Error(
        'DATABASE_URL must require verified TLS; sslmode disable, allow, prefer and no-verify are not allowed.',
      );
    }
  }

  const sslFlag = parsed.searchParams.get('ssl');
  if (sslFlag !== null && sslFlag !== '1' && sslFlag !== 'true') {
    throw new Error('DATABASE_URL ssl must be 1 or true; verified TLS is required.');
  }

  const libpqCompat = parsed.searchParams.get('uselibpqcompat');
  if (libpqCompat !== null && libpqCompat !== 'false') {
    throw new Error(
      'DATABASE_URL uselibpqcompat is unsupported; use sslmode=verify-full.',
    );
  }

  const sslNegotiation = parsed.searchParams.get('sslnegotiation');
  if (
    sslNegotiation !== null &&
    sslNegotiation !== 'postgres' &&
    sslNegotiation !== 'direct'
  ) {
    throw new Error('DATABASE_URL sslnegotiation must be postgres or direct.');
  }

  const channelBinding = parsed.searchParams.get('channel_binding') ?? 'disable';
  if (channelBinding === 'require') {
    throw new Error(
      'DATABASE_URL channel_binding=require cannot be guaranteed by pg; prefer enables optional negotiation only.',
    );
  }
  if (channelBinding !== 'disable' && channelBinding !== 'prefer') {
    throw new Error(
      'DATABASE_URL channel_binding must be disable or prefer; other modes are unsupported.',
    );
  }

  const ssl: ConnectionOptions = { rejectUnauthorized: true };
  const caPath =
    environment.PGSSLROOTCERT?.trim() ||
    parsed.searchParams.get('sslrootcert')?.trim() ||
    undefined;

  if (caPath !== undefined) {
    try {
      ssl.ca = readFileSync(caPath, 'utf8');
    } catch {
      throw new Error('PGSSLROOTCERT could not be read.');
    }
  }

  for (const [parameter, field] of [
    ['sslcert', 'cert'], ['sslkey', 'key'],
  ] as const) {
    const path = parsed.searchParams.get(parameter);
    if (path !== null) {
      try {
        ssl[field] = readFileSync(path, 'utf8');
      } catch {
        throw new Error(`DATABASE_URL ${parameter} could not be read.`);
      }
    }
  }

  // pg reparses connectionString and overrides explicit options. Remove every
  // parameter that can recreate ssl, including sslnegotiation=direct, after
  // validating/translating it. Leave connection identity to pg's own parser.
  for (const parameter of [
    'ssl', 'sslmode', 'sslrootcert', 'sslcert', 'sslkey',
    'uselibpqcompat', 'sslnegotiation', 'channel_binding',
  ]) {
    parsed.searchParams.delete(parameter);
  }

  return {
    connectionString: parsed.toString(),
    ssl,
    enableChannelBinding: channelBinding === 'prefer',
    ...(sslNegotiation === null ? {} : { sslnegotiation: sslNegotiation }),
  };
}

function readValue(
  value: string | undefined,
  fallback: string,
  variableName: string,
): string {
  const result = value ?? fallback;

  if (result.trim() === '') {
    throw new Error(`${variableName} must not be empty.`);
  }

  return result;
}
