import {
  Inject,
  Injectable,
  Logger,
  Module,
  type OnApplicationShutdown,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Pool } from 'pg';
import { sanitizeDiagnostic } from '../shared/diagnostics.js';
import { PG_POOL } from './database.tokens.js';
import { readPostgresConfig } from './postgres.config.js';

@Injectable()
class PostgresPoolLifecycle implements OnApplicationShutdown {
  constructor(@Inject(PG_POOL) private readonly pool: Pool) {}

  async onApplicationShutdown(): Promise<void> {
    await this.pool.end();
  }
}

@Module({
  providers: [
    {
      provide: PG_POOL,
      inject: [ConfigService],
      useFactory: (config: ConfigService): Pool => {
        const pool = new Pool(
          readPostgresConfig({
            PGHOST: config.get<string>('PGHOST'),
            PGPORT: config.get<string>('PGPORT'),
            PGDATABASE: config.get<string>('PGDATABASE'),
            PGUSER: config.get<string>('PGUSER'),
            PGPASSWORD: config.get<string>('PGPASSWORD'),
          }),
        );

        pool.on('error', (error: Error) => {
          new Logger('PostgresPool').error(
            `PostgreSQL idle client error: ${sanitizeDiagnostic(
              error,
              'postgres-idle-client',
            )}`,
          );
        });

        return pool;
      },
    },
    PostgresPoolLifecycle,
  ],
  exports: [PG_POOL],
})
export class DatabaseModule {}
