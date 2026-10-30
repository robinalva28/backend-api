import type { PoolConfig } from 'pg';

export interface PostgresEnvironment {
  PGHOST?: string | undefined;
  PGPORT?: string | undefined;
  PGDATABASE?: string | undefined;
  PGUSER?: string | undefined;
  PGPASSWORD?: string | undefined;
}

const DEFAULT_POSTGRES = {
  host: '127.0.0.1',
  port: 5432,
  database: 'backend_api',
  user: 'backend_api',
  password: 'backend-api-local',
} as const;

export function readPostgresConfig(environment: PostgresEnvironment): PoolConfig {
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
