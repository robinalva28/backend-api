import { Module } from '@nestjs/common';
import type { Pool } from 'pg';
import { DatabaseModule } from '../database/database.module.js';
import { PG_POOL } from '../database/database.tokens.js';
import { SearchInstrumentsService } from './application/search-instruments.service.js';
import type { InstrumentSearchRepository } from './application/ports/out/instrument-search.repository.js';
import { InstrumentsController } from './infrastructure/http/instruments.controller.js';
import { SearchInstrumentsQueryPipe } from './infrastructure/http/search-instruments-query.pipe.js';
import { PostgresInstrumentSearchRepository } from './infrastructure/persistence/postgres-instrument-search.repository.js';
import {
  INSTRUMENT_SEARCH_REPOSITORY,
  SEARCH_INSTRUMENTS_USE_CASE,
} from './instruments.tokens.js';

@Module({
  imports: [DatabaseModule],
  controllers: [InstrumentsController],
  providers: [
    SearchInstrumentsQueryPipe,
    {
      provide: INSTRUMENT_SEARCH_REPOSITORY,
      inject: [PG_POOL],
      useFactory: (pool: Pool): PostgresInstrumentSearchRepository =>
        new PostgresInstrumentSearchRepository(pool),
    },
    {
      provide: SEARCH_INSTRUMENTS_USE_CASE,
      inject: [INSTRUMENT_SEARCH_REPOSITORY],
      useFactory: (
        repository: InstrumentSearchRepository,
      ): SearchInstrumentsService =>
        new SearchInstrumentsService(repository),
    },
  ],
  exports: [SEARCH_INSTRUMENTS_USE_CASE],
})
export class InstrumentsModule {}
