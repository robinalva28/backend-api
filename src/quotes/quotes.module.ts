import { Module } from '@nestjs/common';
import type { Pool } from 'pg';
import { DatabaseModule } from '../database/database.module.js';
import { PG_POOL } from '../database/database.tokens.js';
import type { LatestQuoteRepository } from './application/ports/out/latest-quote.repository.js';
import { PostgresLatestQuoteRepository } from './infrastructure/persistence/postgres-latest-quote.repository.js';
import { LATEST_QUOTE_REPOSITORY } from './quotes.tokens.js';

@Module({
  imports: [DatabaseModule],
  providers: [
    {
      provide: LATEST_QUOTE_REPOSITORY,
      inject: [PG_POOL],
      useFactory: (pool: Pool): LatestQuoteRepository =>
        new PostgresLatestQuoteRepository(pool),
    },
  ],
  exports: [LATEST_QUOTE_REPOSITORY],
})
export class QuotesModule {}
