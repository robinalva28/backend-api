import {
  Inject,
  Injectable,
  Module,
  type OnApplicationShutdown,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Pool } from 'pg';
import { failureLogFields } from '../shared/logging/failure-fields.js';
import { getOperationalLogger } from '../shared/logging/operational-logger.js';
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
            DATABASE_URL: config.get<string>('DATABASE_URL'),
            PGSSLROOTCERT: config.get<string>('PGSSLROOTCERT'),
            PGHOST: config.get<string>('PGHOST'),
            PGPORT: config.get<string>('PGPORT'),
            PGDATABASE: config.get<string>('PGDATABASE'),
            PGUSER: config.get<string>('PGUSER'),
            PGPASSWORD: config.get<string>('PGPASSWORD'),
          }),
        );

        pool.on('error', (error: Error) => {
          getOperationalLogger().error(
            'postgres.idle_client_error',
            failureLogFields(error, 'postgres-idle-client'),
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
